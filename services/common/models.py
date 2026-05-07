"""
Base model for database entities
"""

from datetime import datetime
from typing import Any, Dict, Optional
import uuid


class BaseModel:
    """Base class for all database models"""

    table_name: str = ""

    def __init__(self, **kwargs):
        self.id = kwargs.get("id", str(uuid.uuid4()))
        self.created_at = kwargs.get("created_at", datetime.utcnow())
        self.updated_at = kwargs.get("updated_at", datetime.utcnow())

    def to_dict(self) -> Dict[str, Any]:
        """Convert model to dictionary"""
        result = {}
        for key, value in self.__dict__.items():
            if isinstance(value, datetime):
                result[key] = value.isoformat()
            else:
                result[key] = value
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]):
        """Create model from dictionary"""
        return cls(**data)

    def save(self, db):
        """Save model to database"""
        if not self.table_name:
            raise NotImplementedError("table_name not defined")

        columns = []
        values = []
        placeholders = []

        for key, value in self.to_dict().items():
            columns.append(key)
            values.append(value)
            placeholders.append("%s")

        query = f"""
            INSERT INTO {self.table_name} ({", ".join(columns)})
            VALUES ({", ".join(placeholders)})
            ON CONFLICT (id) DO UPDATE SET
            {", ".join([f"{col} = EXCLUDED.{col}" for col in columns])}
        """

        db.execute_query(query, tuple(values))

    @classmethod
    def find_by_id(cls, db, id: str):
        """Find model by ID"""
        if not cls.table_name:
            raise NotImplementedError("table_name not defined")

        result = db.execute_one(f"SELECT * FROM {cls.table_name} WHERE id = %s", (id,))

        if result:
            return cls(**result)
        return None

    @classmethod
    def find_all(cls, db, limit: int = 100, offset: int = 0):
        """Find all models"""
        if not cls.table_name:
            raise NotImplementedError("table_name not defined")

        results = db.execute_query(
            f"SELECT * FROM {cls.table_name} LIMIT %s OFFSET %s", (limit, offset)
        )

        return [cls(**r) for r in results]

    def delete(self, db):
        """Delete model from database"""
        if not self.table_name:
            raise NotImplementedError("table_name not defined")

        db.execute_query(f"DELETE FROM {self.table_name} WHERE id = %s", (self.id,))
