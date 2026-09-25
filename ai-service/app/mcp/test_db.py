from app.mcp.db import db_pool


def main():
    with db_pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database(), current_user;")
            result = cur.fetchone()
            print("Database:", result[0])
            print("User:", result[1])


if __name__ == "__main__":
    main()