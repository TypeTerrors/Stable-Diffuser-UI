package dependencies

import (
	"be/proto"
	"context"
	"time"
)

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
