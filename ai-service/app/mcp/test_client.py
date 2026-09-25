import anyio

from mcp import Client


USER_ID = "185cedf4-31ed-4c5f-92b3-5303a3e1362f"


async def main():
    async with Client("http://127.0.0.1:8001/mcp") as client:

        print("Connected to MCP server")

        result = await client.list_tools()

        print("\nAvailable MCP tools:")

        for tool in result.tools:
            print(f"- {tool.name}")

        print("\nTesting student_context...")

        result = await client.call_tool(
            "student_context",
            {
                "user_id": USER_ID
            }
        )

        print("\nstudent_context:")
        print(result)

        print("\nTesting academic_context...")

        result = await client.call_tool(
            "academic_context",
            {
                "user_id": USER_ID
            }
        )

        print("\nacademic_context:")
        print(result)

        print("\nTesting user_goals...")

        result = await client.call_tool(
            "user_goals",
            {
                "user_id": USER_ID
            }
        )

        print("\nuser_goals:")
        print(result)

        print("\nTesting selected_subjects...")

        result = await client.call_tool(
            "selected_subjects",
            {
                "user_id": USER_ID
            }
        )

        print("\nselected_subjects:")
        print(result)


if __name__ == "__main__":
    anyio.run(main)