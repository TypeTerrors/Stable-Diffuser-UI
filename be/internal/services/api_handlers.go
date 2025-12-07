package services

import (
	"be/types"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
)

func (a *Api) Health() fiber.Handler {
	return func(ctx *fiber.Ctx) error {

		return ctx.Status(fiber.StatusOK).JSON(types.HealthResponse{
			Status:    fiber.StatusOK,
			TimeStamp: time.Now().Unix(),
		})
	}
}

func (a *Api) GenerateImage() fiber.Handler {
	return func(ctx *fiber.Ctx) error {

		var requestBody types.ImagePostRequest
		if err := ctx.BodyParser(&requestBody); err != nil {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "invalid body",
			})
		}

		// now is the time to implement then call the rpc service
		resp, err := a.rpc.GenerateImage(requestBody.PositivePrompt, requestBody.NegativePrompt)
		if err != nil {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to generate image",
			})
		}

		ctx.Set(fiber.HeaderContentType, resp.MimeType)
		ctx.Set(fiber.HeaderContentDisposition, fmt.Sprintf("inline; filename=%s", resp.FilenameHint))
		ctx.Response().SetBodyRaw(resp.Image)
		return nil
	}
}
