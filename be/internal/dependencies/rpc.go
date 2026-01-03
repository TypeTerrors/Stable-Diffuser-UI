package dependencies

import (
	"context"
	"fmt"
	"time"

	"be/proto"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type Config struct {
	Peer            string
	Port            string
	DialTimeout     time.Duration
	T2ITimeout      time.Duration
	I2VTimeout      time.Duration
	MaxMsgSizeBytes int
}

type Rpc struct {
	conn       *grpc.ClientConn
	t2iTimeout time.Duration
	i2vTimeout time.Duration
}

func NewRpc(cfg Config) (*Rpc, error) {
	if cfg.Peer == "" {
		return nil, fmt.Errorf("rpc peer is required")
	}
	if cfg.Port == "" {
		return nil, fmt.Errorf("rpc port is required")
	}
	if cfg.DialTimeout <= 0 {
		return nil, fmt.Errorf("rpc dial timeout must be > 0")
	}
	if cfg.T2ITimeout <= 0 {
		return nil, fmt.Errorf("rpc t2i timeout must be > 0")
	}
	if cfg.I2VTimeout <= 0 {
		return nil, fmt.Errorf("rpc i2v timeout must be > 0")
	}
	if cfg.MaxMsgSizeBytes <= 0 {
		return nil, fmt.Errorf("rpc max message size must be > 0")
	}

	conn, err := grpc.Dial(
		fmt.Sprint(cfg.Peer, ":", cfg.Port),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithConnectParams(grpc.ConnectParams{
			MinConnectTimeout: cfg.DialTimeout,
		}),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(cfg.MaxMsgSizeBytes),
			grpc.MaxCallSendMsgSize(cfg.MaxMsgSizeBytes),
			grpc.WaitForReady(true),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("error creating newrpc: %w", err)
	}

	return &Rpc{
		conn:       conn,
		t2iTimeout: cfg.T2ITimeout,
		i2vTimeout: cfg.I2VTimeout,
	}, nil
}

func (r *Rpc) GenerateTextToImage(positivePrompt, negativePrompt string) (*proto.GenerateImageResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), r.t2iTimeout)
	defer cancel()

	client := proto.NewInferenceServiceClient(r.conn)
	resp, err := client.GenerateImage(ctx, &proto.GenerateImageRequest{
		PositivePrompt: positivePrompt,
		NegativePrompt: negativePrompt,
	})
	if err != nil {
		return nil, err
	}

	return resp, nil
}

func (r *Rpc) GenerateImageToVideo(imageBytes []byte, positivePrompt, negativePrompt string) (*proto.GenerateImageToVideoResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), r.i2vTimeout)
	defer cancel()

	client := proto.NewInferenceServiceClient(r.conn)
	resp, err := client.GenerateImageToVideo(ctx, &proto.GenerateImageToVideoRequest{
		Image:          imageBytes,
		PositivePrompt: positivePrompt,
		NegativePrompt: negativePrompt,
	})

	if err != nil {
		return nil, err
	}

	return resp, nil
}

func (r *Rpc) Close() {
	_ = r.conn.Close()
}
