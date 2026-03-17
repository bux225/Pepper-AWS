#!/bin/bash
# Update the pepper-tools action group with all 7 functions
set -e

AGENT_ID="QFEQBUCQUJ"
ACTION_GROUP_ID="EGLZ8WO1II"
REGION="us-west-2"

aws bedrock-agent update-agent-action-group \
  --agent-id "$AGENT_ID" \
  --agent-version DRAFT \
  --action-group-id "$ACTION_GROUP_ID" \
  --action-group-name pepper-tools \
  --action-group-executor '{"customControl":"RETURN_CONTROL"}' \
  --function-schema '{
    "functions": [
      {
        "name": "searchKnowledge",
        "description": "Search the user'\''s knowledge base for relevant documents.",
        "parameters": {
          "query": {
            "description": "The search query",
            "type": "string",
            "required": true
          },
          "limit": {
            "description": "Max results to return (default 5, max 50)",
            "type": "integer",
            "required": false
          }
        }
      },
      {
        "name": "createNote",
        "description": "Save a note to the user'\''s knowledge base.",
        "parameters": {
          "title": {
            "description": "Note title",
            "type": "string",
            "required": true
          },
          "content": {
            "description": "Note body content",
            "type": "string",
            "required": true
          },
          "tags": {
            "description": "Tags for categorization (array of strings)",
            "type": "array",
            "required": false
          }
        }
      },
      {
        "name": "draftEmail",
        "description": "Draft an email and save it to the outbox for user review.",
        "parameters": {
          "to": {
            "description": "Recipient email addresses (array of strings)",
            "type": "array",
            "required": false
          },
          "subject": {
            "description": "Email subject",
            "type": "string",
            "required": true
          },
          "body": {
            "description": "Email body content",
            "type": "string",
            "required": true
          }
        }
      },
      {
        "name": "draftTeamsMessage",
        "description": "Draft a Teams message and save it to the outbox for user review.",
        "parameters": {
          "content": {
            "description": "Message content",
            "type": "string",
            "required": true
          }
        }
      },
      {
        "name": "createTodo",
        "description": "Create a new todo item.",
        "parameters": {
          "title": {
            "description": "Todo title",
            "type": "string",
            "required": true
          },
          "description": {
            "description": "Additional details",
            "type": "string",
            "required": false
          },
          "priority": {
            "description": "Priority level: high, medium, or low",
            "type": "string",
            "required": false
          },
          "dueDate": {
            "description": "Due date in ISO 8601 format",
            "type": "string",
            "required": false
          }
        }
      },
      {
        "name": "completeTodo",
        "description": "Mark a todo item as done.",
        "parameters": {
          "todoId": {
            "description": "The ID of the todo to complete",
            "type": "string",
            "required": true
          }
        }
      },
      {
        "name": "listTodos",
        "description": "List the user'\''s todo items.",
        "parameters": {
          "status": {
            "description": "Filter: open, done, or cancelled",
            "type": "string",
            "required": false
          },
          "limit": {
            "description": "Max results (default 20, max 50)",
            "type": "integer",
            "required": false
          }
        }
      }
    ]
  }' \
  --region "$REGION" \
  --no-cli-pager

echo ""
echo "Action group updated with all 7 functions."
