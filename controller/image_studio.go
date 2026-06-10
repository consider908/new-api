package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

const defaultImageStudioModel = "gpt-image-2"

type imageStudioKey struct {
	Id             int      `json:"id"`
	Name           string   `json:"name"`
	Key            string   `json:"key"`
	Group          string   `json:"group"`
	ResolvedGroups []string `json:"resolved_groups"`
	RemainQuota    int      `json:"remain_quota"`
	UnlimitedQuota bool     `json:"unlimited_quota"`
	ExpiredTime    int64    `json:"expired_time"`
}

func GetImageStudioKeys(c *gin.Context) {
	userId := c.GetInt("id")
	modelName := strings.TrimSpace(c.Query("model"))
	if modelName == "" {
		modelName = defaultImageStudioModel
	}

	user, err := model.GetUserCache(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	tokens, err := model.GetAllUserTokens(userId, 0, operation_setting.GetMaxUserTokens())
	if err != nil {
		common.ApiError(c, err)
		return
	}

	keys := make([]imageStudioKey, 0)
	for _, token := range tokens {
		if !isImageStudioTokenEligible(token, user.Group, modelName) {
			continue
		}
		keys = append(keys, imageStudioKey{
			Id:             token.Id,
			Name:           token.Name,
			Key:            token.GetMaskedKey(),
			Group:          token.Group,
			ResolvedGroups: resolveImageStudioTokenGroups(token.Group, user.Group),
			RemainQuota:    token.RemainQuota,
			UnlimitedQuota: token.UnlimitedQuota,
			ExpiredTime:    token.ExpiredTime,
		})
	}

	common.ApiSuccess(c, keys)
}

func isImageStudioTokenEligible(token *model.Token, userGroup string, modelName string) bool {
	if token == nil {
		return false
	}
	if token.Status != common.TokenStatusEnabled {
		return false
	}
	if token.ExpiredTime != -1 && token.ExpiredTime < common.GetTimestamp() {
		return false
	}
	if !token.UnlimitedQuota && token.RemainQuota <= 0 {
		return false
	}
	if token.ModelLimitsEnabled && !tokenAllowsImageStudioModel(token, modelName) {
		return false
	}

	resolvedGroups, ok := resolveEligibleImageStudioTokenGroups(token.Group, userGroup)
	if !ok {
		return false
	}
	for _, group := range resolvedGroups {
		if model.GroupHasEnabledModel(group, modelName) {
			return true
		}
	}
	return false
}

func tokenAllowsImageStudioModel(token *model.Token, modelName string) bool {
	limits := token.GetModelLimitsMap()
	if limits[modelName] {
		return true
	}
	normalized := ratio_setting.FormatMatchingModelName(modelName)
	return normalized != "" && limits[normalized]
}

func resolveImageStudioTokenGroups(tokenGroup string, userGroup string) []string {
	group := strings.TrimSpace(tokenGroup)
	if group == "" {
		group = userGroup
	}
	if group == "auto" {
		return service.GetUserAutoGroup(userGroup)
	}
	if group == "" {
		return []string{}
	}
	return []string{group}
}

func resolveEligibleImageStudioTokenGroups(tokenGroup string, userGroup string) ([]string, bool) {
	group := strings.TrimSpace(tokenGroup)
	if group == "" {
		group = userGroup
	}

	if tokenGroup != "" {
		if _, ok := service.GetUserUsableGroups(userGroup)[group]; !ok {
			return nil, false
		}
		if group != "auto" && !ratio_setting.ContainsGroupRatio(group) {
			return nil, false
		}
	}

	return resolveImageStudioTokenGroups(group, userGroup), true
}
