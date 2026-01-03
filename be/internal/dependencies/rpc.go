package dependencies

import (
	"context"
	"fmt"
	"time"

	"be/proto"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type Rpc struct {
	ctx    *context.Context
	cancel context.CancelFunc
	conn   *grpc.ClientConn
}

func NewRpc(peer, port string) (*Rpc, error) {

	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)

	conn, err := grpc.DialContext(
		ctx,
		fmt.Sprint(peer, ":", port),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("error creating newrpc: %w", err)
	}

	return &Rpc{
		ctx:    &ctx,
		conn:   conn,
		cancel: cancel,
	}, nil
}

func (r *Rpc) GenerateImage(positivePrompt, negativePrompt string) (*proto.GenerateImageResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.GenerateImage(ctx, &proto.GenerateImageRequest{
		PositivePrompt: positivePrompt,
		NegativePrompt: negativePrompt,
	})
	if err != nil {
		return nil, err
	}

	return resp, nil
}

func (r *Rpc) SetModel(modelPath string) (*proto.SetModelResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.SetModel(ctx, &proto.SetModelRequest{
		ModelPath: modelPath,
	})
	if err != nil {
		return nil, err
	}

	return resp, nil
}

func (r *Rpc) GetCurrentModel() (*proto.GetCurrentModelResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.GetCurrentModel(ctx, &proto.GetCurrentModelRequest{})
	if err != nil {
		return nil, err
	}

	return resp, nil
}

func (r *Rpc) GetCurrentLoras() (*proto.GetCurrentLorasResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.GetCurrentLoras(ctx, &proto.GetCurrentLorasRequest{})
	if err != nil {
		return nil, err
	}

	return resp, nil
}

func (r *Rpc) ClearModel() (*proto.ClearModelResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.ClearModel(ctx, &proto.ClearModelRequest{})
	if err != nil {
		return nil, err
	}

	return resp, nil
}

func (r *Rpc) ClearLoras() (*proto.ClearLorasResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.ClearLoras(ctx, &proto.ClearLorasRequest{})
	if err != nil {
		return nil, err
	}

	return resp, nil
}

func (r *Rpc) SetLoras(loraPaths []*proto.SetLora) (*proto.SetLoraResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.SetLora(ctx, &proto.SetLoraRequest{
		Loras: loraPaths,
	})
	if err != nil {
		return nil, err
	}

	return resp, nil
}

func (r *Rpc) Close() {
	r.cancel()
	r.conn.Close()
}
