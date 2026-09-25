import json

from mcp import Client


MCP_SERVER_URL = "http://127.0.0.1:8001/mcp"


async def call_mcp_tool(
    tool_name: str,
    arguments: dict,
) -> dict:
    """
    Call a SmartLearn MCP tool and return its JSON payload.
    """

    async with Client(MCP_SERVER_URL) as client:

        result = await client.call_tool(
            tool_name,
            arguments,
        )

        if result.is_error:
            raise RuntimeError(
                f"MCP tool '{tool_name}' failed: {result.content}"
            )

        for content in result.content:
            if getattr(content, "type", None) == "text":
                return json.loads(content.text)

        raise RuntimeError(
            f"MCP tool '{tool_name}' returned no JSON content."
        )