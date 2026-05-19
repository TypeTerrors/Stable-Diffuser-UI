package services

import (
	"be/proto"
	"be/types"
	"context"
	"encoding/base64"
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

func decodeBase64Payload(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if comma := strings.Index(value, ","); comma >= 0 && strings.Contains(value[:comma], "base64") {
		value = value[comma+1:]
	}
	value = strings.NewReplacer("\n", "", "\r", "", "\t", "", " ", "").Replace(value)

	decoders := []*base64.Encoding{
		base64.StdEncoding,
		base64.RawStdEncoding,
		base64.URLEncoding,
		base64.RawURLEncoding,
	}
	var lastErr error
	for _, decoder := range decoders {
		decoded, err := decoder.DecodeString(value)
		if err == nil {
			return decoded, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

func mediaTypeFromMime(mimeType string) string {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	switch {
	case strings.HasPrefix(mimeType, "video/"):
		return "video"
	case strings.HasPrefix(mimeType, "image/"):
		return "image"
	default:
		return "media"
	}
}

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

func (a *Api) GenerateMedia() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		logger := HttpLogger("GenerateMedia", ctx)

		var requestBody types.MediaPostRequest
		if err := ctx.BodyParser(&requestBody); err != nil {
			logger.Error("invalid body", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "invalid body",
			})
		}

		var inputImage []byte
		var inputImageMimeType string
		var inputImageFilename string
		if requestBody.InputImage != nil && strings.TrimSpace(requestBody.InputImage.DataBase64) != "" {
			decoded, err := decodeBase64Payload(requestBody.InputImage.DataBase64)
			if err != nil {
				logger.Error("invalid input image base64", "err", err)
				return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
					Error:   err.Error(),
					Message: "invalid input image data",
				})
			}
			inputImage = decoded
			inputImageMimeType = strings.TrimSpace(requestBody.InputImage.MimeType)
			inputImageFilename = strings.TrimSpace(requestBody.InputImage.Filename)
		}

		mode := strings.TrimSpace(requestBody.Mode)
		if mode == "" {
			mode = "auto"
		}

		logger.Info(
			"media generate requested",
			"mode", mode,
			"positiveLen", len(requestBody.PositivePrompt),
			"negativeLen", len(requestBody.NegativePrompt),
			"inputImageBytes", len(inputImage),
		)

		resp, err := a.rpc.GenerateMedia(&proto.GenerateMediaRequest{
			PositivePrompt:     requestBody.PositivePrompt,
			NegativePrompt:     requestBody.NegativePrompt,
			Mode:               mode,
			InputImage:         inputImage,
			InputImageMimeType: inputImageMimeType,
			InputImageFilename: inputImageFilename,
		})
		if err != nil {
			logger.Error("media generate failed", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to generate media",
			})
		}

		mediaType := strings.TrimSpace(resp.MediaType)
		if mediaType == "" {
			mediaType = mediaTypeFromMime(resp.MimeType)
		}
		filenameHint := strings.TrimSpace(resp.FilenameHint)
		if filenameHint == "" {
			filenameHint = "generated"
		}

		logger.Info("media generate completed", "mediaType", mediaType, "mimeType", resp.MimeType, "bytes", len(resp.Media))

		ctx.Set(fiber.HeaderContentType, resp.MimeType)
		ctx.Set("X-Media-Type", mediaType)
		ctx.Set(fiber.HeaderContentDisposition, fmt.Sprintf("inline; filename=%s", filenameHint))
		ctx.Response().SetBodyRaw(resp.Media)
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

		logger.Info("set model requested", "modelPath", requestBody.ModelPath)
		resp, err := a.rpc.SetModel(requestBody.ModelPath)
		if err != nil {
			logger.Error("set model failed", "modelPath", requestBody.ModelPath, "err", err)
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

func (a *Api) SetLlmModel() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		logger := HttpLogger("SetLlmModel", ctx)

		var requestBody types.SetModelRequest
		if err := ctx.BodyParser(&requestBody); err != nil {
			logger.Error("invalid body", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "invalid body",
			})
		}

		modelPath := strings.TrimSpace(requestBody.ModelPath)
		if modelPath == "" {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   "modelPath is required",
				Message: "invalid body",
			})
		}

		logger.Info("set llm model requested", "modelPath", modelPath)
		resp, err := a.rpc.SetLlmModel(modelPath)
		if err != nil {
			logger.Error("set llm model failed", "modelPath", modelPath, "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "python service failed to set llm model",
			})
		}

		logger.Info("set llm model completed", "modelPath", resp.ModelPath)
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
			if modelId != "" && a.dl != nil && a.dl.client != nil {
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
			base := filepath.Base(applied.Path)
			stem := strings.TrimSuffix(base, filepath.Ext(applied.Path))
			modelId := strings.Split(stem, "-")[0]

			var triggers *string
			if modelId != "" && a.dl != nil && a.dl.client != nil {
				info, err := a.dl.client.GetModelVersionInfo(modelId)
				if err == nil && len(info.TrainedWords) > 0 {
					joined := strings.Join(info.TrainedWords, ",")
					triggers = &joined
				}
			}

			appliedloras = append(appliedloras, types.SetLora{Path: applied.Path, Weight: applied.Weight, TriggerWords: triggers})
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

func (a *Api) Conversation() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		logger := HttpLogger("Conversation", ctx)

		var requestBody types.ConversationRequest
		if err := ctx.BodyParser(&requestBody); err != nil {
			logger.Error("invalid body", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "invalid body",
			})
		}

		a.ConversationManager.mx.Lock()
		if _, ok := a.ConversationManager.clients[requestBody.Username]; !ok {

			a.ConversationManager.mx.Unlock()
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   fmt.Errorf("Username does not have websocket connection established").Error(),
				Message: "invalid body",
			})
		}
		a.ConversationManager.mx.Unlock()

		go func() {
			// LLM responses can take minutes depending on model load/throughput and max token settings.
			streamCtx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
			a.ConversationManager.SetStreamCancel(requestBody.Username, cancel)
			defer cancel()
			defer a.ConversationManager.ClearStreamCancel(requestBody.Username)

			if err := a.rpc.Conversation(streamCtx, &proto.ConversationRequest{
				Username: requestBody.Username,
				Prompt:   requestBody.Prompt,
			}); err != nil {
				log.Error("rpc conversation failed", "username", requestBody.Username, "err", err)
			}
		}()

		return ctx.Status(fiber.StatusAccepted).JSON(types.ConversationEstablishedResponse{
			Status: fiber.StatusOK,
		})
	}
}

func (a *Api) ConversationStop() fiber.Handler {
	return func(ctx *fiber.Ctx) error {
		logger := HttpLogger("ConversationStop", ctx)

		var requestBody types.ConversationStopRequest
		if err := ctx.BodyParser(&requestBody); err != nil {
			logger.Error("invalid body", "err", err)
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   err.Error(),
				Message: "invalid body",
			})
		}

		if requestBody.Username == "" {
			return ctx.Status(fiber.StatusBadRequest).JSON(types.ErrorResponse{
				Error:   "username is required",
				Message: "invalid body",
			})
		}

		if ok := a.ConversationManager.CancelStream(requestBody.Username); !ok {
			return ctx.Status(fiber.StatusNotFound).JSON(types.ErrorResponse{
				Error:   "no active conversation stream",
				Message: "stream not found",
			})
		}

		return ctx.Status(fiber.StatusOK).JSON(types.ConversationStopResponse{
			Status: fiber.StatusOK,
		})
	}
}
