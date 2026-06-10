package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

type imageStudioKeysResponse struct {
	Items []imageStudioKey `json:"items"`
}

func seedImageStudioUser(t *testing.T, dbUserId int, group string) {
	t.Helper()
	user := &model.User{
		Id:       dbUserId,
		Username: "user",
		Password: "password",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    group,
	}
	if err := model.DB.Create(user).Error; err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
}

func seedImageStudioAbility(t *testing.T, group string, modelName string) {
	t.Helper()
	channel := &model.Channel{
		Id:     100,
		Type:   1,
		Status: common.ChannelStatusEnabled,
		Name:   "image-channel",
		Key:    "upstream-key",
		Group:  group,
		Models: modelName,
	}
	if err := model.DB.Create(channel).Error; err != nil {
		t.Fatalf("failed to create channel: %v", err)
	}
	if err := model.DB.Create(&model.Ability{
		Group:     group,
		Model:     modelName,
		ChannelId: channel.Id,
		Enabled:   true,
	}).Error; err != nil {
		t.Fatalf("failed to create ability: %v", err)
	}
}

func seedImageStudioToken(t *testing.T, name string, key string, group string, mutate func(*model.Token)) *model.Token {
	t.Helper()
	token := &model.Token{
		UserId:         1,
		Name:           name,
		Key:            key,
		Status:         common.TokenStatusEnabled,
		CreatedTime:    1,
		AccessedTime:   1,
		ExpiredTime:    -1,
		RemainQuota:    100,
		UnlimitedQuota: false,
		Group:          group,
	}
	if mutate != nil {
		mutate(token)
	}
	if err := model.DB.Create(token).Error; err != nil {
		t.Fatalf("failed to create token: %v", err)
	}
	return token
}

func decodeImageStudioKeys(t *testing.T, response tokenAPIResponse) []imageStudioKey {
	t.Helper()
	var keys []imageStudioKey
	if err := common.Unmarshal(response.Data, &keys); err != nil {
		t.Fatalf("failed to decode image studio keys: %v", err)
	}
	return keys
}

func TestGetImageStudioKeysFiltersEligibleTokens(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	if err := db.AutoMigrate(&model.User{}, &model.Channel{}, &model.Ability{}); err != nil {
		t.Fatalf("failed to migrate tables: %v", err)
	}
	t.Cleanup(func() {
		_ = setting.UpdateAutoGroupsByJsonString(`["default"]`)
		_ = setting.UpdateUserUsableGroupsByJSONString(`{"default":"默认分组","vip":"vip分组","auto":"自动分组"}`)
		_ = ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"vip":1,"svip":1}`)
	})

	seedImageStudioUser(t, 1, "default")
	seedImageStudioAbility(t, "default", "gpt-image-2")
	if err := setting.UpdateUserUsableGroupsByJSONString(`{"default":"默认分组","vip":"vip分组","legacy":"legacy分组"}`); err != nil {
		t.Fatalf("failed to update user usable groups: %v", err)
	}

	eligible := seedImageStudioToken(t, "eligible", "eligible-key", "default", nil)
	seedImageStudioToken(t, "other-user", "other-user-key", "default", func(token *model.Token) {
		token.UserId = 2
	})
	seedImageStudioToken(t, "disabled", "disabled-key", "default", func(token *model.Token) {
		token.Status = common.TokenStatusDisabled
	})
	seedImageStudioToken(t, "expired", "expired-key", "default", func(token *model.Token) {
		token.ExpiredTime = common.GetTimestamp() - 1
	})
	seedImageStudioToken(t, "exhausted", "exhausted-key", "default", func(token *model.Token) {
		token.RemainQuota = 0
	})
	seedImageStudioToken(t, "wrong-limit", "wrong-limit-key", "default", func(token *model.Token) {
		token.ModelLimitsEnabled = true
		token.ModelLimits = "gpt-4o"
	})
	limited := seedImageStudioToken(t, "limited", "limited-key", "default", func(token *model.Token) {
		token.ModelLimitsEnabled = true
		token.ModelLimits = "gpt-image-2"
	})
	seedImageStudioToken(t, "unusable-group", "unusable-group-key", "premium", nil)
	if err := ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"svip":1}`); err != nil {
		t.Fatalf("failed to update group ratios: %v", err)
	}
	seedImageStudioToken(t, "deprecated-group", "deprecated-group-key", "legacy", nil)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/image-studio/keys?model=gpt-image-2", nil, 1)
	GetImageStudioKeys(ctx)

	response := decodeAPIResponse(t, recorder)
	if !response.Success {
		t.Fatalf("expected success response: %s", response.Message)
	}
	keys := decodeImageStudioKeys(t, response)
	if len(keys) != 2 {
		t.Fatalf("expected 2 eligible keys, got %d: %#v", len(keys), keys)
	}
	got := map[int]bool{}
	for _, item := range keys {
		got[item.Id] = true
		if item.Key == "eligible-key" || item.Key == "limited-key" {
			t.Fatalf("expected masked key, got full key %q", item.Key)
		}
	}
	if !got[eligible.Id] || !got[limited.Id] {
		t.Fatalf("expected eligible and limited tokens in response, got %#v", got)
	}
	for _, item := range keys {
		if item.Name == "unusable-group" || item.Name == "deprecated-group" {
			t.Fatalf("unexpected ineligible token in response: %#v", item)
		}
	}
}

func TestGetImageStudioKeysSupportsAutoGroup(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	if err := db.AutoMigrate(&model.User{}, &model.Channel{}, &model.Ability{}); err != nil {
		t.Fatalf("failed to migrate tables: %v", err)
	}
	t.Cleanup(func() {
		_ = setting.UpdateAutoGroupsByJsonString(`["default"]`)
		_ = setting.UpdateUserUsableGroupsByJSONString(`{"default":"默认分组","vip":"vip分组"}`)
		_ = ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"vip":1,"svip":1}`)
	})

	seedImageStudioUser(t, 1, "default")
	seedImageStudioAbility(t, "premium", "gpt-image-2")
	if err := setting.UpdateAutoGroupsByJsonString(`["premium"]`); err != nil {
		t.Fatalf("failed to update auto groups: %v", err)
	}
	if err := setting.UpdateUserUsableGroupsByJSONString(`{"default":"默认分组","vip":"vip分组","premium":"premium分组","auto":"自动分组"}`); err != nil {
		t.Fatalf("failed to update user usable groups: %v", err)
	}
	if err := ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"vip":1,"premium":1}`); err != nil {
		t.Fatalf("failed to update group ratios: %v", err)
	}

	autoToken := seedImageStudioToken(t, "auto", "auto-key", "auto", nil)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/image-studio/keys?model=gpt-image-2", nil, 1)
	GetImageStudioKeys(ctx)

	response := decodeAPIResponse(t, recorder)
	keys := decodeImageStudioKeys(t, response)
	if len(keys) != 1 || keys[0].Id != autoToken.Id {
		t.Fatalf("expected auto token to be eligible, got %#v", keys)
	}
	if len(keys[0].ResolvedGroups) != 1 || keys[0].ResolvedGroups[0] != "premium" {
		t.Fatalf("expected resolved premium group, got %#v", keys[0].ResolvedGroups)
	}
}
