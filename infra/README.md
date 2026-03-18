# Pepper AWS Infrastructure

Terraform configuration that creates all AWS resources for the Pepper app in a single `terraform apply`.

## What it creates

| Resource | Name | Purpose |
|---|---|---|
| S3 Bucket | `pepper-kb-data` | Content storage (emails, notes, chats) |
| OpenSearch Serverless Collection | `pepper-kb-vectors` | Vector store for KB embeddings |
| Bedrock Knowledge Base | `pepper-knowledge-base` | Managed RAG — chunking, embedding, retrieval |
| KB Data Source | `pepper-s3-source` | S3 → KB sync (hierarchical chunking) |
| Bedrock Agent | `pepper-agent` | Claude Sonnet 4 with KB + tools |
| Agent Action Group | `pepper-tools` | 7 ROC functions (search, notes, todos, email, Teams) |
| Agent Alias | `live` | Stable alias for the app |
| IAM Role (KB) | `pepper-bedrock-kb-role` | KB access to S3 + embedding model |
| IAM Role (Agent) | `pepper-bedrock-agent-role` | Agent access to model + KB |
| IAM Policy | `pepper-local-app` | Your IAM user's permissions |

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- AWS CLI configured (`aws configure` or `~/.aws/credentials`)
- Your IAM user needs permissions to create the above resources

## Quick Start

```bash
cd infra

# Initialize Terraform
terraform init

# Preview what will be created
terraform plan

# Create everything
terraform apply
```

After `apply` completes, it prints an `env_local_snippet` output — paste that into `app/.env.local`:

```bash
# View just the env snippet
terraform output -raw env_local_snippet
```

Or generate the full `.env.local` template:

```bash
# Appends AWS vars to .env.local (preserves existing content)
terraform output -raw env_local_snippet >> ../app/.env.local
```

## Customization

Override defaults with a `terraform.tfvars` file:

```hcl
# terraform.tfvars
aws_region      = "us-east-1"
resource_prefix = "my-pepper"      # changes all resource names
iam_user_name   = "matt"           # auto-attaches policy to this IAM user
```

Or via CLI:

```bash
terraform apply -var="aws_region=us-east-1" -var="iam_user_name=matt"
```

### Variables

| Variable | Default | Description |
|---|---|---|
| `aws_region` | `us-west-2` | AWS region |
| `resource_prefix` | `pepper` | Prefix for all resource names |
| `agent_model_id` | `anthropic.claude-sonnet-4-20250514` | Agent foundation model |
| `embedding_model_id` | `amazon.titan-embed-text-v2:0` | KB embedding model |
| `iam_user_name` | `""` | IAM user to attach policy to (empty = skip) |

## Teardown

```bash
# ⚠️  This destroys everything including S3 data
terraform destroy
```

> Note: S3 bucket has `force_destroy = false` by default. If you need to destroy it, either empty it first or change to `true`.

## After Terraform

You still need to:

1. **Configure AWS credentials** for the app — either `~/.aws/credentials` or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in `.env.local`
2. **Set up Azure AD** for Microsoft 365 OAuth (see `AWS-SETUP.md` section 6)
3. **Add remaining `.env.local` values**: `MS_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `LOG_LEVEL`
4. **Run the app**: `cd app && npm install && npm run dev`
5. **Connect Microsoft account** in Settings
