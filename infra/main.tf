terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Local state by default. Switch to S3 backend if desired.
  # backend "s3" {
  #   bucket = "your-tf-state-bucket"
  #   key    = "pepper/terraform.tfstate"
  #   region = "us-west-2"
  # }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  prefix     = var.resource_prefix
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name
}

# =============================================================================
# 1. S3 Bucket — Content storage
# =============================================================================

resource "aws_s3_bucket" "kb_data" {
  bucket        = "${local.prefix}-kb-data"
  force_destroy = false

  tags = {
    Project = "pepper"
  }
}

resource "aws_s3_bucket_public_access_block" "kb_data" {
  bucket = aws_s3_bucket.kb_data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "kb_data" {
  bucket = aws_s3_bucket.kb_data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# =============================================================================
# 2. IAM Role — Bedrock Knowledge Base execution role
# =============================================================================

resource "aws_iam_role" "bedrock_kb" {
  name = "${local.prefix}-bedrock-kb-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "bedrock.amazonaws.com"
      }
      Action = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = local.account_id
        }
      }
    }]
  })

  tags = { Project = "pepper" }
}

resource "aws_iam_role_policy" "bedrock_kb_s3" {
  name = "${local.prefix}-kb-s3-access"
  role = aws_iam_role.bedrock_kb.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.kb_data.arn,
          "${aws_s3_bucket.kb_data.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "bedrock_kb_model" {
  name = "${local.prefix}-kb-embedding-model"
  role = aws_iam_role.bedrock_kb.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = "bedrock:InvokeModel"
      Resource = "arn:aws:bedrock:${local.region}::foundation-model/${var.embedding_model_id}"
    }]
  })
}

# KB role needs AOSS permissions to read/write the vector index
resource "aws_iam_role_policy" "bedrock_kb_aoss" {
  name = "${local.prefix}-kb-aoss-access"
  role = aws_iam_role.bedrock_kb.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = "aoss:APIAccessAll"
      Resource = aws_opensearchserverless_collection.kb.arn
    }]
  })
}

# KB role needs inference profile access for RetrieveAndGenerate (RAG model)
resource "aws_iam_role_policy" "bedrock_kb_inference_profile" {
  name = "${local.prefix}-kb-inference-profile"
  role = aws_iam_role.bedrock_kb.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "bedrock:InvokeModel",
        "bedrock:GetInferenceProfile"
      ]
      Resource = [
        "arn:aws:bedrock:${local.region}:${local.account_id}:inference-profile/us.${var.agent_model_id}*",
        "arn:aws:bedrock:${local.region}:${local.account_id}:application-inference-profile/us.${var.agent_model_id}*",
        "arn:aws:bedrock:*::foundation-model/${var.agent_model_id}"
      ]
    }]
  })
}

# =============================================================================
# 3. IAM Role — Bedrock Agent execution role
# =============================================================================

resource "aws_iam_role" "bedrock_agent" {
  name = "${local.prefix}-bedrock-agent-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "bedrock.amazonaws.com"
      }
      Action = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = local.account_id
        }
      }
    }]
  })

  tags = { Project = "pepper" }
}

resource "aws_iam_role_policy" "bedrock_agent_model" {
  name = "${local.prefix}-agent-model-invoke"
  role = aws_iam_role.bedrock_agent.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ]
      Resource = [
        "arn:aws:bedrock:${local.region}::foundation-model/${var.agent_model_id}",
        "arn:aws:bedrock:${local.region}:${local.account_id}:inference-profile/us.${var.agent_model_id}*"
      ]
    }]
  })
}

resource "aws_iam_role_policy" "bedrock_agent_kb" {
  name = "${local.prefix}-agent-kb-access"
  role = aws_iam_role.bedrock_agent.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "bedrock:Retrieve",
        "bedrock:RetrieveAndGenerate"
      ]
      Resource = "arn:aws:bedrock:${local.region}:${local.account_id}:knowledge-base/*"
    }]
  })
}

# =============================================================================
# 4. IAM Policy — Local app user permissions
# =============================================================================

resource "aws_iam_policy" "app_user" {
  name        = "${local.prefix}-local-app"
  description = "Permissions for Pepper local app to access S3, Bedrock KB, and Bedrock Agent"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "PepperS3"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.kb_data.arn,
          "${aws_s3_bucket.kb_data.arn}/*"
        ]
      },
      {
        Sid    = "PepperBedrockModels"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:GetInferenceProfile",
          "bedrock:ListInferenceProfiles",
          "bedrock:GetFoundationModelAvailability"
        ]
        Resource = [
          "arn:aws:bedrock:${local.region}::foundation-model/${var.agent_model_id}",
          "arn:aws:bedrock:${local.region}::foundation-model/${var.embedding_model_id}",
          "arn:aws:bedrock:${local.region}:${local.account_id}:inference-profile/us.${var.agent_model_id}*"
        ]
      },
      {
        Sid    = "PepperBedrockAgent"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeAgent",
          "bedrock:GetAgent",
          "bedrock:GetAgentAlias"
        ]
        Resource = [
          "arn:aws:bedrock:${local.region}:${local.account_id}:agent/*",
          "arn:aws:bedrock:${local.region}:${local.account_id}:agent-alias/*"
        ]
      },
      {
        Sid    = "PepperBedrockKB"
        Effect = "Allow"
        Action = [
          "bedrock:Retrieve",
          "bedrock:RetrieveAndGenerate",
          "bedrock:StartIngestionJob",
          "bedrock:GetIngestionJob",
          "bedrock:GetKnowledgeBase"
        ]
        Resource = "arn:aws:bedrock:${local.region}:${local.account_id}:knowledge-base/*"
      }
    ]
  })

  tags = { Project = "pepper" }
}

# Optionally attach to an IAM user
resource "aws_iam_user_policy_attachment" "app_user" {
  count      = var.iam_user_name != "" ? 1 : 0
  user       = var.iam_user_name
  policy_arn = aws_iam_policy.app_user.arn
}

# =============================================================================
# 5. Bedrock Knowledge Base
# =============================================================================

resource "aws_bedrockagent_knowledge_base" "main" {
  name        = "${local.prefix}-knowledge-base"
  description = "Pepper personal assistant knowledge base — emails, notes, chats, browser history"
  role_arn    = aws_iam_role.bedrock_kb.arn

  knowledge_base_configuration {
    type = "VECTOR"

    vector_knowledge_base_configuration {
      embedding_model_arn = "arn:aws:bedrock:${local.region}::foundation-model/${var.embedding_model_id}"
    }
  }

  storage_configuration {
    type = "OPENSEARCH_SERVERLESS"

    opensearch_serverless_configuration {
      collection_arn    = aws_opensearchserverless_collection.kb.arn
      vector_index_name = "bedrock-knowledge-base-default-index"

      field_mapping {
        vector_field   = "bedrock-knowledge-base-default-vector"
        text_field     = "AMAZON_BEDROCK_TEXT_CHUNK"
        metadata_field = "AMAZON_BEDROCK_METADATA"
      }
    }
  }

  tags = { Project = "pepper" }

  depends_on = [
    aws_iam_role_policy.bedrock_kb_s3,
    aws_iam_role_policy.bedrock_kb_model,
    aws_opensearchserverless_access_policy.kb,
    time_sleep.wait_for_collection,
  ]
}

# =============================================================================
# 5a. OpenSearch Serverless — Vector store for KB
# =============================================================================

resource "aws_opensearchserverless_security_policy" "kb_encryption" {
  name = "${local.prefix}-kb-enc"
  type = "encryption"

  policy = jsonencode({
    Rules = [{
      ResourceType = "collection"
      Resource     = ["collection/${local.prefix}-kb-vectors"]
    }]
    AWSOwnedKey = true
  })
}

resource "aws_opensearchserverless_security_policy" "kb_network" {
  name = "${local.prefix}-kb-net"
  type = "network"

  policy = jsonencode([{
    Rules = [{
      ResourceType = "collection"
      Resource     = ["collection/${local.prefix}-kb-vectors"]
    }, {
      ResourceType = "dashboard"
      Resource     = ["collection/${local.prefix}-kb-vectors"]
    }]
    AllowFromPublic = true
  }])
}

resource "aws_opensearchserverless_access_policy" "kb" {
  name = "${local.prefix}-kb-access"
  type = "data"

  policy = jsonencode([{
    Rules = [
      {
        ResourceType = "index"
        Resource     = ["index/${local.prefix}-kb-vectors/*"]
        Permission   = [
          "aoss:CreateIndex",
          "aoss:UpdateIndex",
          "aoss:DescribeIndex",
          "aoss:ReadDocument",
          "aoss:WriteDocument"
        ]
      },
      {
        ResourceType = "collection"
        Resource     = ["collection/${local.prefix}-kb-vectors"]
        Permission   = [
          "aoss:CreateCollectionItems",
          "aoss:DescribeCollectionItems",
          "aoss:UpdateCollectionItems"
        ]
      }
    ]
    Principal = [
      aws_iam_role.bedrock_kb.arn,
      "arn:aws:iam::${local.account_id}:root"
    ]
  }])
}

resource "aws_opensearchserverless_collection" "kb" {
  name = "${local.prefix}-kb-vectors"
  type = "VECTORSEARCH"

  depends_on = [
    aws_opensearchserverless_security_policy.kb_encryption,
    aws_opensearchserverless_security_policy.kb_network,
  ]

  tags = { Project = "pepper" }
}

# Wait for collection to be active before creating KB
resource "time_sleep" "wait_for_collection" {
  depends_on      = [aws_opensearchserverless_collection.kb]
  create_duration = "60s"
}

# =============================================================================
# 5b. KB Data Source — S3
# =============================================================================

resource "aws_bedrockagent_data_source" "s3" {
  knowledge_base_id = aws_bedrockagent_knowledge_base.main.id
  name              = "${local.prefix}-s3-source"

  data_source_configuration {
    type = "S3"

    s3_configuration {
      bucket_arn = aws_s3_bucket.kb_data.arn
    }
  }

  vector_ingestion_configuration {
    chunking_configuration {
      chunking_strategy = "HIERARCHICAL"

      hierarchical_chunking_configuration {
        overlap_tokens = 60

        level_configuration {
          max_tokens = 1500
        }
        level_configuration {
          max_tokens = 300
        }
      }
    }
  }
}

# =============================================================================
# 6. Bedrock Agent
# =============================================================================

resource "aws_bedrockagent_agent" "main" {
  agent_name              = "${local.prefix}-agent"
  description             = "Pepper personal assistant — manages knowledge, todos, email drafts, and notes"
  agent_resource_role_arn = aws_iam_role.bedrock_agent.arn
  foundation_model        = var.agent_model_id
  idle_session_ttl_in_seconds = 1800

  instruction = <<-EOT
    You are Pepper, a personal AI assistant. You help the user manage their knowledge, emails, Teams messages, todos, and notes.

    Behavioral guidelines:
    - Be concise and direct. The user is a professional and prefers brief answers.
    - When the user asks about something, search their knowledge base first before answering.
    - When you identify action items, offer to create todos.
    - When drafting emails or Teams messages, always save them to the outbox for review — never claim you sent them.
    - If the user asks you to remember something, create a note.
    - Cite your sources when referencing stored knowledge.
  EOT

  tags = { Project = "pepper" }

  depends_on = [
    aws_iam_role_policy.bedrock_agent_model,
    aws_iam_role_policy.bedrock_agent_kb,
  ]
}

# =============================================================================
# 6a. Agent ↔ Knowledge Base Association
# =============================================================================

resource "aws_bedrockagent_agent_knowledge_base_association" "main" {
  agent_id             = aws_bedrockagent_agent.main.agent_id
  knowledge_base_id    = aws_bedrockagent_knowledge_base.main.id
  description          = "Use this knowledge base to search the user's emails, Teams chats, notes, documents, and browser history. Always search here when the user asks about their data."
  knowledge_base_state = "ENABLED"
}

# =============================================================================
# 6b. Agent Action Group — Return of Control (no Lambda)
# =============================================================================

resource "aws_bedrockagent_agent_action_group" "tools" {
  agent_id          = aws_bedrockagent_agent.main.agent_id
  action_group_name = "${local.prefix}-tools"
  agent_version     = "DRAFT"

  action_group_executor {
    custom_control = "RETURN_CONTROL"
  }

  function_schema {
    member_functions {
      functions {
        name        = "searchKnowledge"
        description = "Search the user's knowledge base for relevant documents."

        parameters {
          map_block_key = "query"
          type          = "string"
          description   = "The search query"
          required      = true
        }

        parameters {
          map_block_key = "limit"
          type          = "integer"
          description   = "Max results to return (default 5, max 50)"
          required      = false
        }
      }

      functions {
        name        = "createNote"
        description = "Save a note to the user's knowledge base."

        parameters {
          map_block_key = "title"
          type          = "string"
          description   = "Note title"
          required      = true
        }

        parameters {
          map_block_key = "content"
          type          = "string"
          description   = "Note body content"
          required      = true
        }

        parameters {
          map_block_key = "tags"
          type          = "array"
          description   = "Tags for categorization (array of strings)"
          required      = false
        }
      }

      functions {
        name        = "draftEmail"
        description = "Draft an email and save it to the outbox for user review."

        parameters {
          map_block_key = "to"
          type          = "array"
          description   = "Recipient email addresses (array of strings)"
          required      = false
        }

        parameters {
          map_block_key = "subject"
          type          = "string"
          description   = "Email subject"
          required      = true
        }

        parameters {
          map_block_key = "body"
          type          = "string"
          description   = "Email body content"
          required      = true
        }
      }

      functions {
        name        = "draftTeamsMessage"
        description = "Draft a Teams message and save it to the outbox for user review."

        parameters {
          map_block_key = "content"
          type          = "string"
          description   = "Message content"
          required      = true
        }
      }

      functions {
        name        = "createTodo"
        description = "Create a new todo item."

        parameters {
          map_block_key = "title"
          type          = "string"
          description   = "Todo title"
          required      = true
        }

        parameters {
          map_block_key = "description"
          type          = "string"
          description   = "Additional details"
          required      = false
        }

        parameters {
          map_block_key = "priority"
          type          = "string"
          description   = "Priority level: high, medium, or low"
          required      = false
        }

        parameters {
          map_block_key = "dueDate"
          type          = "string"
          description   = "Due date in ISO 8601 format"
          required      = false
        }
      }

      functions {
        name        = "completeTodo"
        description = "Mark a todo item as done."

        parameters {
          map_block_key = "todoId"
          type          = "string"
          description   = "The ID of the todo to complete"
          required      = true
        }
      }

      functions {
        name        = "listTodos"
        description = "List the user's todo items."

        parameters {
          map_block_key = "status"
          type          = "string"
          description   = "Filter: open, done, or cancelled"
          required      = false
        }

        parameters {
          map_block_key = "limit"
          type          = "integer"
          description   = "Max results (default 20, max 50)"
          required      = false
        }
      }
    }
  }
}

# =============================================================================
# 6c. Agent Alias — "live"
# =============================================================================

resource "aws_bedrockagent_agent_alias" "live" {
  agent_id         = aws_bedrockagent_agent.main.agent_id
  agent_alias_name = "live"
  description      = "Production alias for Pepper app"

  depends_on = [
    aws_bedrockagent_agent_action_group.tools,
    aws_bedrockagent_agent_knowledge_base_association.main,
  ]
}
