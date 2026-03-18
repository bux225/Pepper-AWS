variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-west-2"
}

variable "resource_prefix" {
  description = "Prefix for all resource names (e.g., 'pepper' → 'pepper-kb-data')"
  type        = string
  default     = "pepper"
}

variable "agent_model_id" {
  description = "Bedrock foundation model for the agent (chat + orchestration)"
  type        = string
  default     = "anthropic.claude-sonnet-4-20250514"
}

variable "embedding_model_id" {
  description = "Bedrock embedding model for the knowledge base"
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

variable "iam_user_name" {
  description = "IAM user to attach the app policy to (leave empty to skip)"
  type        = string
  default     = ""
}
