package services

import (
	"be/proto"
	"be/types"
	"fmt"
	"io/fs"
	"path/filepath"
	"strings"
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
func (a *Api) ListModels() fiber.Handler {
	return func(ctx *fiber.Ctx) error {

		var files []string
		extension := "safetensors"
		root := "./models"
		if !strings.HasPrefix(extension, ".") {
			extension = "." + extension
		}

		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				fmt.Printf("preventing termination: error on path %q: %v\n", path, err)
				return nil
			}

			if !d.IsDir() && strings.HasSuffix(d.Name(), extension) {
				files = append(files, path)
			}
			return nil
		})

		if err != nil {
			ctx.Status(fiber.StatusInternalServerError)
			ctx.JSON(ErrorResponse{
				Error: err.Error(),
				Message: "Failed to walk model files.",
			})
			return nil
		}

		ctx.Status(fiber.StatusOK)
		ctx.JSON(listModelsResponse{
			ModelPaths: files,
		})
		return nil
	}
}
func (a *Api) ListLoras() fiber.Handler {
	return func(ctx *fiber.Ctx) error {

		var files []string
		extension := "safetensors"
		root := "./loras"
		if !strings.HasPrefix(extension, ".") {
			extension = "." + extension
		}

		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}

			if !d.IsDir() && strings.HasSuffix(d.Name(), extension) {
				files = append(files, path)
			}
			return nil
		})

		if err != nil {
			ctx.Status(fiber.StatusInternalServerError)
			ctx.JSON(ErrorResponse{
				Error: err.Error(),
				Message: "Failed to walk model files.",
			})
			return nil
		}

		ctx.Status(fiber.StatusOK)
		ctx.JSON(ListLorasResponse{
			LoraPaths: files,
		})
		return nil
	}
}

func (a *Api) SetModel() fiber.Handler {
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
func (a *Api) SetLoras() fiber.Handler {
	return func(ctx *fiber.Ctx) error {

		var requestBody []proto.SetLora
		if err := ctx.BodyParser(&requestBody); err != nil {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "invalid body",
			})
		}

		lorapaths := make([]*proto.SetLora, 0, len(requestBody))
		for i := range requestBody {
			lorapaths = append(lorapaths, &proto.SetLora{
				Weight: requestBody[i].Weight,
				Path:   requestBody[i].Path,
			})
		}

		resp, err := a.rpc.SetLoras(lorapaths)
		if err != nil {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to generate image",
			})
		}

		var appliedloras []proto.SetLora
		for _, applied := range resp.Loras {
			appliedloras = append(appliedloras, proto.SetLora{
				Path:   applied.Path,
				Weight: applied.Weight,
			})
		}

		ctx.Status(fiber.StatusOK)
		ctx.JSON(appliedloras)

		return nil
	}
}
