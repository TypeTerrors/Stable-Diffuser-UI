package dependencies

import (
	"be/proto"
	"context"
	"errors"
	"io"
	"time"
)

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

func (r *Rpc) GenerateMedia(req *proto.GenerateMediaRequest) (*proto.GenerateMediaResponse, error) {
	start := time.Now()
	r.logger.Debug(
		"rpc GenerateMedia",
		"mode", req.Mode,
		"positiveLen", len(req.PositivePrompt),
		"negativeLen", len(req.NegativePrompt),
		"inputImageBytes", len(req.InputImage),
	)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()

	client := proto.NewImageServiceClient(r.conn)
	resp, err := client.GenerateMedia(ctx, req)
	if err != nil {
		r.logger.Error("rpc GenerateMedia failed", "dur", time.Since(start).String(), "err", err)
		return nil, err
	}
	r.logger.Info(
		"rpc GenerateMedia ok",
		"dur", time.Since(start).String(),
		"mediaType", resp.MediaType,
		"mimeType", resp.MimeType,
		"bytes", len(resp.Media),
	)
	return resp, nil
}

func (r *Rpc) Conversation(ctx context.Context, req *proto.ConversationRequest) error {

	r.logger.Info("rpc conversation initiated")

	stream, err := proto.NewImageServiceClient(r.conn).Conversation(ctx, req)
	if err != nil {
		return err
	}

	for {
		msg, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			// stream finished
			return nil
		}
		if err != nil {
			return err
		}

		if r.sink != nil {
			r.sink.SendMessage(req.Username, msg.Message)
		}
	}
}
