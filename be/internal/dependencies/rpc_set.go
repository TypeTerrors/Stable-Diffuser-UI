package dependencies

import (
	"be/proto"
	"context"
	"time"
)

func (r *Rpc) SetModel(modelPath string) (*proto.SetModelResponse, error) {
	start := time.Now()
	r.logger.Info("rpc SetModel", "modelPath", modelPath)
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.SetModel(ctx, &proto.SetModelRequest{
		ModelPath: modelPath,
	})
	if err != nil {
		r.logger.Error("rpc SetModel failed", "dur", time.Since(start).String(), "err", err)
		return nil, err
	}
	r.logger.Info("rpc SetModel ok", "dur", time.Since(start).String(), "modelPath", resp.ModelPath)
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

func (r *Rpc) SetLlmModel(llmPath string) (*proto.SetLlmModelResponse, error) {
	start := time.Now()
	r.logger.Info("rpc SetLlm")
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.SetLlmModel(ctx, &proto.SetLlmModelRequest{
		ModelPath: llmPath,
	})

	if err != nil {
		r.logger.Error("rpc SetLlm failed", "dur", time.Since(start).String(), "err", err)
		return nil, err
	}
	r.logger.Info("rpc SetLlm ok", "dur", time.Since(start).String(), "applied", llmPath)
	return resp, nil
}
