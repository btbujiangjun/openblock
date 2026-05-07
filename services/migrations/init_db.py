"""
Database schema migration script for PostgreSQL
Run with: python init_db.py
"""

import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

POSTGRES_AVAILABLE = True
try:
    import psycopg2
except ImportError:
    print("psycopg2 not installed. Install with: pip install psycopg2-binary")
    POSTGRES_AVAILABLE = False


def create_tables(cursor):
    """Create all database tables"""

    # Users table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(36) PRIMARY KEY,
            username VARCHAR(255) UNIQUE NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE,
            is_premium BOOLEAN DEFAULT FALSE,
            profile_data JSONB DEFAULT '{}'
        )
    """)

    # User profiles table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_profiles (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
            display_name VARCHAR(255),
            avatar_url VARCHAR(512),
            bio TEXT,
            settings JSONB DEFAULT '{}',
            preferences JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Friend relationships table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS friend_relationships (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
            friend_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
            status VARCHAR(50) DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, friend_id)
        )
    """)

    # Sessions table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
            token VARCHAR(512) NOT NULL,
            refresh_token VARCHAR(512),
            expires_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Game sessions table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS game_sessions (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
            mode VARCHAR(50) DEFAULT 'endless',
            started_at TIMESTAMP,
            ended_at TIMESTAMP,
            score INTEGER DEFAULT 0,
            clears INTEGER DEFAULT 0,
            max_combo INTEGER DEFAULT 0,
            blocks_placed INTEGER DEFAULT 0,
            game_data JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Leaderboards table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS leaderboards (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
            score INTEGER DEFAULT 0,
            clears INTEGER DEFAULT 0,
            mode VARCHAR(50) DEFAULT 'global',
            period VARCHAR(50) DEFAULT 'all_time',
            rank INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Achievements table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS achievements (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
            achievement_id VARCHAR(100) NOT NULL,
            unlocked_at TIMESTAMP,
            progress INTEGER DEFAULT 0,
            completed BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Level progress table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS level_progress (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
            level_id VARCHAR(50) NOT NULL,
            stars INTEGER DEFAULT 0,
            best_score INTEGER DEFAULT 0,
            attempts INTEGER DEFAULT 0,
            completed BOOLEAN DEFAULT FALSE,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, level_id)
        )
    """)

    # Analytics events table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS analytics_events (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
            event_type VARCHAR(100) NOT NULL,
            event_data JSONB DEFAULT '{}',
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            session_id VARCHAR(36)
        )
    """)

    # User activities table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_activities (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            active_minutes INTEGER DEFAULT 0,
            sessions_count INTEGER DEFAULT 0,
            total_score INTEGER DEFAULT 0,
            retention_d1 BOOLEAN DEFAULT FALSE,
            retention_d7 BOOLEAN DEFAULT FALSE,
            retention_d30 BOOLEAN DEFAULT FALSE,
            UNIQUE(user_id, date)
        )
    """)

    # Revenue table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS revenue (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
            amount DECIMAL(10, 2) DEFAULT 0,
            currency VARCHAR(10) DEFAULT 'USD',
            product_id VARCHAR(100),
            purchase_date TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Create indexes
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_game_sessions_user ON game_sessions(user_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_game_sessions_date ON game_sessions(started_at)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_leaderboards_score ON leaderboards(score DESC)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_activities_date ON user_activities(date)"
    )

    print("All tables created successfully!")


def main():
    if not POSTGRES_AVAILABLE:
        print("PostgreSQL not available. Skipping migration.")
        return

    conn = psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=os.getenv("POSTGRES_PORT", "5432"),
        database=os.getenv("POSTGRES_DB", "openblock"),
        user=os.getenv("POSTGRES_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", "postgres"),
    )

    cursor = conn.cursor()

    create_tables(cursor)

    conn.commit()
    cursor.close()
    conn.close()

    print("Database migration completed!")


if __name__ == "__main__":
    main()
