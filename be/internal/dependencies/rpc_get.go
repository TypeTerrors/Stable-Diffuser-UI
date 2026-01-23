package dependencies

import (
	"be/proto"
	"context"
	"time"
)

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

func (r *Rpc) GetCurrentLlm() (*proto.GetCurrentModelResponse, error) {
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

