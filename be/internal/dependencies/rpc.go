package dependencies

import (
	"context"
	"fmt"
	"strings"
	"time"

	"be/proto"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/charmbracelet/log"
)

type Rpc struct {
	ctx    *context.Context
	cancel context.CancelFunc
	conn   *grpc.ClientConn
	peer   string
	logger *log.Logger
}

func NewRpc(peer, port string) (*Rpc, error) {
	addr := fmt.Sprint(peer, ":", port)
	logger := log.With("component", "rpc", "peer", addr)
	logger.Info("rpc connecting")

	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)

	conn, err := grpc.DialContext(
		ctx,
		addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		cancel()
		logger.Error("rpc connect failed", "err", err)
		return nil, fmt.Errorf("error creating newrpc: %w", err)
	}
	logger.Info("rpc connected")

	return &Rpc{
		ctx:    &ctx,
		conn:   conn,
		cancel: cancel,
		peer:   addr,
		logger: logger,
	}, nil
}

func (r *Rpc) GenerateImage(positivePrompt, negativePrompt string) (*proto.GenerateImageResponse, error) {
	start := time.Now()
	r.logger.Debug("rpc GenerateImage", "positiveLen", len(positivePrompt), "negativeLen", len(negativePrompt))
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.GenerateImage(ctx, &proto.GenerateImageRequest{
		PositivePrompt: positivePrompt,
		NegativePrompt: negativePrompt,
	})
	if err != nil {
		r.logger.Error("rpc GenerateImage failed", "dur", time.Since(start).String(), "err", err)
		return nil, err
	}
	r.logger.Info("rpc GenerateImage ok", "dur", time.Since(start).String(), "bytes", len(resp.Image))
	return resp, nil
}

func (r *Rpc) GenerateImageToVideo(image []byte, positivePrompt, negativePrompt string) (*proto.GenerateImageToVideoResonse, error) {
	start := time.Now()
	r.logger.Debug("rpc GenerateImage", "positiveLen", len(positivePrompt), "negativeLen", len(negativePrompt))
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.GenerateImageToVideo(ctx, &proto.GenerateImageToVideoRequest{
		PositivePrompt: positivePrompt,
		NegativePrompt: negativePrompt,
		Image:          image,
	})

	if err != nil {
		r.logger.Error("rpc GenerateImageToVideo failed", "dur", time.Since(start).String(), "err", err)
		return nil, err
	}

	r.logger.Info("rpc GenerateImage ok", "dur", time.Since(start).String(), "bytes", len(resp.Video))

	return resp, nil
}

func parseModelType(value string) (proto.ModelType, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	switch normalized {
	case "", "t2i":
		return proto.ModelType_t2i, nil
	case "i2v":
		return proto.ModelType_i2v, nil
	default:
		return proto.ModelType__UNKOWN, fmt.Errorf("unknown modelType %q (expected \"t2i\" or \"i2v\")", value)
	}
}

func (r *Rpc) SetModel(modelPath string, modelType string) (*proto.SetModelResponse, error) {
	start := time.Now()
	r.logger.Info("rpc SetModel", "modelPath", modelPath, "modelType", modelType)
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	mt, err := parseModelType(modelType)
	if err != nil {
		return nil, err
	}

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.SetModel(ctx, &proto.SetModelRequest{
		ModelPath: modelPath,
		ModelType: mt,
	})
	if err != nil {
		r.logger.Error("rpc SetModel failed", "dur", time.Since(start).String(), "err", err)
		return nil, err
	}
	r.logger.Info("rpc SetModel ok", "dur", time.Since(start).String(), "modelPath", resp.ModelPath)
	return resp, nil
}

func (r *Rpc) GetCurrentModel() (*proto.GetCurrentModelResponse, error) {
	start := time.Now()
	r.logger.Debug("rpc GetCurrentModel")
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.GetCurrentModel(ctx, &proto.GetCurrentModelRequest{})
	if err != nil {
		r.logger.Error("rpc GetCurrentModel failed", "dur", time.Since(start).String(), "err", err)
		return nil, err
	}
	r.logger.Debug("rpc GetCurrentModel ok", "dur", time.Since(start).String(), "modelPath", resp.ModelPath)
	return resp, nil
}

func (r *Rpc) GetCurrentLoras() (*proto.GetCurrentLorasResponse, error) {
	start := time.Now()
	r.logger.Debug("rpc GetCurrentLoras")
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.GetCurrentLoras(ctx, &proto.GetCurrentLorasRequest{})
	if err != nil {
		r.logger.Error("rpc GetCurrentLoras failed", "dur", time.Since(start).String(), "err", err)
		return nil, err
	}
	r.logger.Debug("rpc GetCurrentLoras ok", "dur", time.Since(start).String(), "count", len(resp.Loras))
	return resp, nil
}

func (r *Rpc) ClearModel() (*proto.ClearModelResponse, error) {
	start := time.Now()
	r.logger.Info("rpc ClearModel")
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.ClearModel(ctx, &proto.ClearModelRequest{})
	if err != nil {
		r.logger.Error("rpc ClearModel failed", "dur", time.Since(start).String(), "err", err)
		return nil, err
	}
	r.logger.Info("rpc ClearModel ok", "dur", time.Since(start).String(), "modelPath", resp.ModelPath, "loras", len(resp.Loras))
	return resp, nil
}

func (r *Rpc) ClearLoras() (*proto.ClearLorasResponse, error) {
	start := time.Now()
	r.logger.Info("rpc ClearLoras")
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.ClearLoras(ctx, &proto.ClearLorasRequest{})
	if err != nil {
		r.logger.Error("rpc ClearLoras failed", "dur", time.Since(start).String(), "err", err)
		return nil, err
	}
	r.logger.Info("rpc ClearLoras ok", "dur", time.Since(start).String(), "loras", len(resp.Loras))
	return resp, nil
}

func (r *Rpc) SetLoras(loraPaths []*proto.SetLora) (*proto.SetLoraResponse, error) {
	start := time.Now()
	r.logger.Info("rpc SetLoras", "count", len(loraPaths))
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.SetLora(ctx, &proto.SetLoraRequest{
		Loras: loraPaths,
	})
	if err != nil {
		r.logger.Error("rpc SetLoras failed", "dur", time.Since(start).String(), "err", err)
		return nil, err
	}
	r.logger.Info("rpc SetLoras ok", "dur", time.Since(start).String(), "applied", len(resp.Loras))
	return resp, nil
}

func (r *Rpc) Close() {
	if r.logger != nil {
		r.logger.Info("rpc closing")
	}
	r.cancel()
	r.conn.Close()
}
