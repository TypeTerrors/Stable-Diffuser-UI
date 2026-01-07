package huggingface

import (
	"encoding/json"
	"time"
)

type ModelIdResponse struct {
	Id   int64  `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`

	ModelVersions []ModelVersionSummary `json:"modelVersions"`
}

type ModelVersionSummary struct {
	Id            int64              `json:"id"`
	Index         *int               `json:"index,omitempty"`
	Name          string             `json:"name"`
	BaseModel     string             `json:"baseModel"`
	BaseModelType *string            `json:"baseModelType,omitempty"`
	DownloadUrl   string             `json:"downloadUrl"`
	TrainedWords  []string           `json:"trainedWords"`
	Files         []ModelVersionFile `json:"files,omitempty"`
}

type ModelVersionIdResponse struct {
	Id          int64      `json:"id"`
	ModelId     int64      `json:"modelId"`
	Name        string     `json:"name"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	PublishedAt *time.Time `json:"publishedAt,omitempty"`

	TrainedWords []string `json:"trainedWords"`

	BaseModel     string  `json:"baseModel"`
	BaseModelType *string `json:"baseModelType,omitempty"`

	Description *string `json:"description"`

	NsfwLevel *int `json:"nsfwLevel,omitempty"`

	Stats  ModelVersionStats   `json:"stats"`
	Model  ModelVersionModel   `json:"model"`
	Files  []ModelVersionFile  `json:"files"`
	Images []ModelVersionImage `json:"images"`

	DownloadUrl string `json:"downloadUrl"`
}

type ModelVersionStats struct {
	DownloadCount   int64  `json:"downloadCount"`
	ThumbsUpCount   *int64 `json:"thumbsUpCount,omitempty"`
	ThumbsDownCount *int64 `json:"thumbsDownCount,omitempty"`
}

type ModelVersionModel struct {
	Name *string `json:"name"`
	Type *string `json:"type"`
	Nsfw *bool   `json:"nsfw"`
	Poi  *bool   `json:"poi"`
}

type ModelVersionFile struct {
	Name              string                   `json:"name"`
	Id                int64                    `json:"id"`
	SizeKB            *float64                 `json:"sizeKB,omitempty"`
	Type              string                   `json:"type"`
	Metadata          ModelVersionFileMetadata `json:"metadata"`
	PickleScanResult  *string                  `json:"pickleScanResult,omitempty"`
	PickleScanMessage *string                  `json:"pickleScanMessage,omitempty"`
	VirusScanResult   *string                  `json:"virusScanResult,omitempty"`
	VirusScanMessage  *string                  `json:"virusScanMessage,omitempty"`
	ScannedAt         *time.Time               `json:"scannedAt,omitempty"`
	Hashes            ModelVersionFileHashes   `json:"hashes"`
	Primary           bool                     `json:"primary"`
	DownloadUrl       string                   `json:"downloadUrl"`
}

type ModelVersionFileMetadata struct {
	Fp     *string `json:"fp"`
	Size   *string `json:"size"`
	Format *string `json:"format"`
}

type ModelVersionFileHashes struct {
	AutoV1 *string `json:"AutoV1"`
	AutoV2 *string `json:"AutoV2"`
	AutoV3 *string `json:"AutoV3,omitempty"`
	SHA256 *string `json:"SHA256"`
	CRC32  *string `json:"CRC32"`
	BLAKE3 *string `json:"BLAKE3"`
}

type ModelVersionImage struct {
	Id                *int64          `json:"id,omitempty"`
	Url               string          `json:"url"`
	Type              *string         `json:"type,omitempty"`
	Width             *int64          `json:"width,omitempty"`
	Height            *int64          `json:"height,omitempty"`
	Hash              *string         `json:"hash,omitempty"`
	NsfwLevel         *int            `json:"nsfwLevel,omitempty"`
	Availability      *string         `json:"availability,omitempty"`
	Minor             *bool           `json:"minor,omitempty"`
	Poi               *bool           `json:"poi,omitempty"`
	OnSite            *bool           `json:"onSite,omitempty"`
	HasMeta           *bool           `json:"hasMeta,omitempty"`
	HasPositivePrompt *bool           `json:"hasPositivePrompt,omitempty"`
	RemixOfId         *int64          `json:"remixOfId,omitempty"`
	Meta              json.RawMessage `json:"meta,omitempty"`
	Metadata          json.RawMessage `json:"metadata,omitempty"`
}
