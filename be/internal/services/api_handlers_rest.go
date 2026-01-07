package services

import (
	"be/proto"
	"be/types"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
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
		root := os.Getenv("MODEL_MOUNT_PATH")
		if root == "" {
			root = "/workspace/models"
		}
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
			ctx.JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "Failed to walk model files.",
			})
			return nil
		}

		ctx.Status(fiber.StatusOK)
		ctx.JSON(types.ListLorasResponse{
			LoraPaths: files,
		})
		return nil
	}
}
func (a *Api) ListLoras() fiber.Handler {
	return func(ctx *fiber.Ctx) error {

		var files []string
		extension := "safetensors"
		root := os.Getenv("LORA_MOUNT_PATH")
		if root == "" {
			root = "/workspace/loras"
		}
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
			ctx.JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "Failed to walk model files.",
			})
			return nil
		}

		ctx.Status(fiber.StatusOK)
		ctx.JSON(types.ListLorasResponse{
			LoraPaths: files,
		})
		return nil
	}
}

func (a *Api) SetModel() fiber.Handler {
	return func(ctx *fiber.Ctx) error {

		var requestBody types.SetModelRequest
		if err := ctx.BodyParser(&requestBody); err != nil {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "invalid body",
			})
		}

		resp, err := a.rpc.SetModel(requestBody.ModelPath)
		if err != nil {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to set model",
			})
		}

		ctx.Status(fiber.StatusOK)
		return ctx.JSON(types.SetModelResponse{
			ModelPath: resp.ModelPath,
		})
	}
}
func (a *Api) SetLoras() fiber.Handler {
	return func(ctx *fiber.Ctx) error {

		var requestBody []types.SetLora
		if err := ctx.BodyParser(&requestBody); err != nil {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "invalid body",
			})
		}

		lorapaths := make([]*proto.SetLora, 0, len(requestBody))
		for i := range requestBody {
			if requestBody[i].Weight < 0.1 {
				return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
					Error:   "invalid lora weight",
					Message: "LoRA weight must be >= 0.1",
				})
			}
			lorapaths = append(lorapaths, &proto.SetLora{
				Weight: requestBody[i].Weight,
				Path:   requestBody[i].Path,
			})
		}

		resp, err := a.rpc.SetLoras(lorapaths)
		if err != nil {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to apply loras",
			})
		}

		appliedloras := make([]types.SetLora, 0, len(resp.Loras))
		for _, applied := range resp.Loras {
			appliedloras = append(appliedloras, types.SetLora{Path: applied.Path, Weight: applied.Weight})
		}

		ctx.Status(fiber.StatusOK)
		ctx.JSON(appliedloras)

		return nil
	}
}

func (a *Api) CurrentModel() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		resp, err := a.rpc.GetCurrentModel()
		if err != nil {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to get current model",
			})
		}

		ctx.Status(fiber.StatusOK)
		return ctx.JSON(types.CurrentModelResponse{ModelPath: resp.ModelPath})
	}
}

func (a *Api) CurrentLoras() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		resp, err := a.rpc.GetCurrentLoras()
		if err != nil {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to get current loras",
			})
		}

		appliedloras := make([]types.SetLora, 0, len(resp.Loras))
		for _, applied := range resp.Loras {
			appliedloras = append(appliedloras, types.SetLora{Path: applied.Path, Weight: applied.Weight})
		}

		ctx.Status(fiber.StatusOK)
		return ctx.JSON(appliedloras)
	}
}

func (a *Api) ClearModel() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		resp, err := a.rpc.ClearModel()
		if err != nil {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to clear model",
			})
		}

		loras := make([]types.SetLora, 0, len(resp.Loras))
		for _, l := range resp.Loras {
			loras = append(loras, types.SetLora{Path: l.Path, Weight: l.Weight})
		}

		ctx.Status(fiber.StatusOK)
		return ctx.JSON(types.ClearModelResponse{
			ModelPath: resp.ModelPath,
			Loras:     loras,
		})
	}
}

func (a *Api) ClearLoras() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		resp, err := a.rpc.ClearLoras()
		if err != nil {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to clear loras",
			})
		}

		loras := make([]types.SetLora, 0, len(resp.Loras))
		for _, l := range resp.Loras {
			loras = append(loras, types.SetLora{Path: l.Path, Weight: l.Weight})
		}

		ctx.Status(fiber.StatusOK)
		return ctx.JSON(loras)
	}
}

func (a *Api) DownloadModel() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		if a.dl == nil {
			return ctx.Status(fiber.StatusInternalServerError).JSON(types.ErrorResponse{
				Error:   "downloader not configured",
				Message: "service unavailable",
			})
		}

		var req DownloadRequest
		if err := ctx.BodyParser(&req); err != nil {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "invalid body",
			})
		}

		if req.ClientID == "" {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   "clientId is required",
				Message: "missing clientId",
			})
		}
		if req.ModelVersionID <= 0 {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   "modelVersionId must be > 0",
				Message: "invalid modelVersionId",
			})
		}

		jobID := uuid.NewString()
		if err := a.dl.Enqueue(DownloadJob{
			JobID:          jobID,
			ClientID:       req.ClientID,
			ModelVersionID: req.ModelVersionID,
		}); err != nil {
			code := fiber.StatusServiceUnavailable
			if errors.Is(err, ErrDownloadQueueFull) {
				code = fiber.StatusTooManyRequests
			}
			return ctx.Status(code).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "failed to enqueue download",
			})
		}

		return ctx.Status(fiber.StatusAccepted).JSON(types.DownloadResponse{JobID: jobID})
	}
}
