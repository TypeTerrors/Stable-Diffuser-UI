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

	"github.com/charmbracelet/log"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func (a *Api) Health() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		HttpLogger("Health", ctx).Debug("health")
		return ctx.Status(fiber.StatusOK).JSON(types.HealthResponse{
			Status:    fiber.StatusOK,
			TimeStamp: time.Now().Unix(),
		})
	}
}

func (a *Api) GenerateImage() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		logger := HttpLogger("GenerateImage", ctx)

		var requestBody types.ImagePostRequest
		if err := ctx.BodyParser(&requestBody); err != nil {
			logger.Error("invalid body", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "invalid body",
			})
		}

		logger.Info("generate requested", "positiveLen", len(requestBody.PositivePrompt), "negativeLen", len(requestBody.NegativePrompt))

		// now is the time to implement then call the rpc service
		resp, err := a.rpc.GenerateImage(requestBody.PositivePrompt, requestBody.NegativePrompt)
		if err != nil {
			logger.Error("generate failed", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to generate image",
			})
		}

		logger.Info("generate completed", "mimeType", resp.MimeType, "bytes", len(resp.Image))

		ctx.Set(fiber.HeaderContentType, resp.MimeType)
		ctx.Set(fiber.HeaderContentDisposition, fmt.Sprintf("inline; filename=%s", resp.FilenameHint))
		ctx.Response().SetBodyRaw(resp.Image)
		return nil
	}
}

func (a *Api) GenerateImageToVideo() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		logger := HttpLogger("GenerateImageToVideo", ctx)

		var requestBody types.ImageToVideoRequest
		if err := ctx.BodyParser(&requestBody); err != nil {
			logger.Error("invalid body", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "invalid body",
			})
		}

		logger.Info("GenerateImageToVideo requested", "positiveLen", len(requestBody.PositivePrompt), "negativeLen", len(requestBody.NegativePrompt))

		resp, err := a.rpc.GenerateImageToVideo(requestBody.Image, requestBody.PositivePrompt, requestBody.NegativePrompt)
		if err != nil {
			logger.Error("generate failed", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to generate video",
			})
		}

		logger.Info("GenerateImageToVideo completed", "mimeType", resp.MimeType, "bytes", len(resp.Video))

		ctx.Set(fiber.HeaderContentType, resp.MimeType)
		ctx.Set(fiber.HeaderContentDisposition, fmt.Sprintf("inline; filename=%s", resp.FilenameHint))
		ctx.Response().SetBodyRaw(resp.Video)
		return nil
	}
}

func (a *Api) ListModels() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		logger := HttpLogger("ListModels", ctx)

		var files []string
		extension := "safetensors"
		root := os.Getenv("MODEL_MOUNT_PATH")
		if root == "" {
			root = "/workspace/models"
		}
		if !strings.HasPrefix(extension, ".") {
			extension = "." + extension
		}

		logger.Debug("scan models", "root", root, "ext", extension)
		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				log.Warn("walkdir error", "path", path, "err", err)
				return nil
			}

			if !d.IsDir() && strings.HasSuffix(d.Name(), extension) {
				files = append(files, path)
			}
			return nil
		})

		if err != nil {
			logger.Error("scan models failed", "root", root, "err", err)
			ctx.Status(fiber.StatusInternalServerError)
			ctx.JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "Failed to walk model files.",
			})
			return nil
		}

		logger.Info("scan models completed", "root", root, "count", len(files))
		ctx.Status(fiber.StatusOK)
		ctx.JSON(types.ListModelsResponse{ModelPaths: files})
		return nil
	}
}
func (a *Api) ListLoras() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		logger := HttpLogger("ListLoras", ctx)

		var files []string
		extension := "safetensors"
		root := os.Getenv("LORA_MOUNT_PATH")
		if root == "" {
			root = "/workspace/loras"
		}
		if !strings.HasPrefix(extension, ".") {
			extension = "." + extension
		}

		logger.Debug("scan loras", "root", root, "ext", extension)
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
			logger.Error("scan loras failed", "root", root, "err", err)
			ctx.Status(fiber.StatusInternalServerError)
			ctx.JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "Failed to walk model files.",
			})
			return nil
		}

		logger.Info("scan loras completed", "root", root, "count", len(files))
		ctx.Status(fiber.StatusOK)
		ctx.JSON(types.ListLorasResponse{
			LoraPaths: files,
		})
		return nil
	}
}

func (a *Api) SetModel() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		logger := HttpLogger("SetModel", ctx)

		var requestBody types.SetModelRequest
		if err := ctx.BodyParser(&requestBody); err != nil {
			logger.Error("invalid body", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "invalid body",
			})
		}

		logger.Info("set model requested", "modelPath", requestBody.ModelPath, "modelType", requestBody.ModelType)
		resp, err := a.rpc.SetModel(requestBody.ModelPath, requestBody.ModelType)
		if err != nil {
			logger.Error("set model failed", "modelPath", requestBody.ModelPath, "modelType", requestBody.ModelType, "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to set model",
			})
		}

		logger.Info("set model completed", "modelPath", resp.ModelPath)
		ctx.Status(fiber.StatusOK)
		return ctx.JSON(types.SetModelResponse{
			ModelPath: resp.ModelPath,
		})
	}
}
func (a *Api) SetLoras() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		logger := HttpLogger("SetLoras", ctx)

		var requestBody []types.SetLora
		if err := ctx.BodyParser(&requestBody); err != nil {
			logger.Error("invalid body", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "invalid body",
			})
		}

		logger.Info("set loras requested", "count", len(requestBody))
		lorapaths := make([]*proto.SetLora, 0, len(requestBody))
		for i := range requestBody {
			if requestBody[i].Weight < 0.1 {
				logger.Warn("invalid lora weight", "path", requestBody[i].Path, "weight", requestBody[i].Weight)
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
			logger.Error("set loras failed", "count", len(lorapaths), "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to apply loras",
			})
		}

		appliedloras := make([]types.SetLora, 0, len(resp.Loras))
		for _, applied := range resp.Loras {

			base := filepath.Base(applied.Path)
			stem := strings.TrimSuffix(base, filepath.Ext(applied.Path))
			modelId := strings.Split(stem, "-")[0]

			var triggers *string
			if modelId != "" {
				info, err := a.dl.client.GetModelVersionInfo(modelId)
				if err == nil && len(info.TrainedWords) > 0 {
					joined := strings.Join(info.TrainedWords, ",")
					triggers = &joined
				}
			}

			appliedloras = append(appliedloras, types.SetLora{
				Path:         applied.Path,
				Weight:       applied.Weight,
				TriggerWords: triggers,
			})
		}

		ctx.Status(fiber.StatusOK)
		ctx.JSON(appliedloras)
		logger.Info("set loras completed", "requested", len(lorapaths), "applied", len(appliedloras))

		return nil
	}
}

func (a *Api) CurrentModel() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		logger := HttpLogger("CurrentModel", ctx)
		resp, err := a.rpc.GetCurrentModel()
		if err != nil {
			logger.Error("get current model failed", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to get current model",
			})
		}

		logger.Debug("get current model", "modelPath", resp.ModelPath)
		ctx.Status(fiber.StatusOK)
		return ctx.JSON(types.CurrentModelResponse{ModelPath: resp.ModelPath})
	}
}

func (a *Api) CurrentLoras() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		logger := HttpLogger("CurrentLoras", ctx)
		resp, err := a.rpc.GetCurrentLoras()
		if err != nil {
			logger.Error("get current loras failed", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to get current loras",
			})
		}

		appliedloras := make([]types.SetLora, 0, len(resp.Loras))
		for _, applied := range resp.Loras {
			appliedloras = append(appliedloras, types.SetLora{Path: applied.Path, Weight: applied.Weight})
		}

		logger.Debug("get current loras", "count", len(appliedloras))
		ctx.Status(fiber.StatusOK)
		return ctx.JSON(appliedloras)
	}
}

func (a *Api) ClearModel() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		logger := HttpLogger("ClearModel", ctx)
		logger.Info("clear model requested")
		resp, err := a.rpc.ClearModel()
		if err != nil {
			logger.Error("clear model failed", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to clear model",
			})
		}

		loras := make([]types.SetLora, 0, len(resp.Loras))
		for _, l := range resp.Loras {
			loras = append(loras, types.SetLora{Path: l.Path, Weight: l.Weight})
		}

		logger.Info("clear model completed", "modelPath", resp.ModelPath, "loras", len(loras))
		ctx.Status(fiber.StatusOK)
		return ctx.JSON(types.ClearModelResponse{
			ModelPath: resp.ModelPath,
			Loras:     loras,
		})
	}
}

func (a *Api) ClearLoras() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		logger := HttpLogger("ClearLoras", ctx)
		logger.Info("clear loras requested")
		resp, err := a.rpc.ClearLoras()
		if err != nil {
			logger.Error("clear loras failed", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to clear loras",
			})
		}

		loras := make([]types.SetLora, 0, len(resp.Loras))
		for _, l := range resp.Loras {
			loras = append(loras, types.SetLora{Path: l.Path, Weight: l.Weight})
		}

		logger.Info("clear loras completed", "removed", len(loras))
		ctx.Status(fiber.StatusOK)
		return ctx.JSON(loras)
	}
}

func (a *Api) DownloadModel() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		logger := HttpLogger("DownloadModel", ctx)
		if a.dl == nil {
			logger.Error("downloader not configured")
			return ctx.Status(fiber.StatusInternalServerError).JSON(types.ErrorResponse{
				Error:   "downloader not configured",
				Message: "service unavailable",
			})
		}

		var req DownloadRequest
		if err := ctx.BodyParser(&req); err != nil {
			logger.Error("invalid body", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "invalid body",
			})
		}

		if req.ClientID == "" {
			logger.Warn("missing clientId")
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   "clientId is required",
				Message: "missing clientId",
			})
		}
		if req.ModelVersionID <= 0 {
			logger.Warn("invalid modelVersionId", "modelVersionId", req.ModelVersionID)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   "modelVersionId must be > 0",
				Message: "invalid modelVersionId",
			})
		}

		jobID := uuid.NewString()
		logger.Info("download enqueue requested", "jobId", jobID, "clientId", req.ClientID, "modelVersionId", req.ModelVersionID)
		if err := a.dl.Enqueue(DownloadJob{
			JobID:          jobID,
			ClientID:       req.ClientID,
			ModelVersionID: req.ModelVersionID,
		}); err != nil {
			code := fiber.StatusServiceUnavailable
			var already AlreadyQueuedError
			if errors.As(err, &already) {
				logger.Info("download already queued", "existingJobId", already.JobID)
				return ctx.Status(fiber.StatusAccepted).JSON(types.DownloadResponse{JobID: already.JobID})
			}
			if errors.Is(err, ErrDownloadQueueFull) {
				code = fiber.StatusTooManyRequests
			}
			logger.Error("download enqueue failed", "jobId", jobID, "clientId", req.ClientID, "modelVersionId", req.ModelVersionID, "err", err)
			return ctx.Status(code).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "failed to enqueue download",
			})
		}

		logger.Info("download enqueued", "jobId", jobID)
		return ctx.Status(fiber.StatusAccepted).JSON(types.DownloadResponse{JobID: jobID})
	}
}
