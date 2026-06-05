from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class ChatQueryRequest(BaseModel):
    query: str = Field(..., description="The coding question or search query from the user")
    n_results: Optional[int] = Field(5, description="Number of source documents to retrieve as context")
    history: Optional[List[Dict[str, str]]] = Field(default=[], description="Previous conversational turns")
    use_files: Optional[bool] = False
    use_search: Optional[bool] = False
    use_graph: Optional[bool] = False
    session_id: Optional[str] = None
    attached_files: Optional[List[str]] = Field(default=[], description="List of file paths to explicitly filter search")

class IngestPathRequest(BaseModel):
    directory_path: str = Field(..., description="Absolute local folder path to ingest")

class QueryResponseSnippet(BaseModel):
    id: str
    content: str
    file_path: str
    start_line: int
    end_line: int
    distance: float
