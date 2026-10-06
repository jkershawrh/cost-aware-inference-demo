"""Read-only MCP example. Live retrieval of explicitly synthetic demo records."""
import json
from fastapi import APIRouter

router = APIRouter()
TOOL = {
    "name": "bakery_batch_evidence",
    "description": "Retrieve synthetic batch observations and a demo quality procedure. Not real factory telemetry or food-safety advice.",
    "inputSchema": {"type": "object", "properties": {"batch_id": {"type": "string", "enum": ["B-204"]}}, "required": ["batch_id"], "additionalProperties": False},
}
EVIDENCE = {
    "data_origin": "synthetic_demo", "batch_id": "B-204", "line": "Oven-2",
    "procedure_id": "BAKE-QA-01/v1", "observed_temperature_c": 168,
    "target_temperature_c": 180, "observation": "uneven browning",
    "sensor_check": "pending", "action_authority": "human_review_required",
    "procedure": "Compare the recorded temperature with the recipe target; request a sensor check and quality review. Do not infer a confirmed root cause, adjust equipment, or release the batch automatically.",
}


@router.post("/bakery/mcp")
async def mcp(request: dict):
    envelope = {"jsonrpc": "2.0", "id": request.get("id")}
    method = request.get("method")
    if method == "initialize":
        return {**envelope, "result": {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "bakery-demo-evidence", "version": "1.0"}}}
    if method == "tools/list":
        return {**envelope, "result": {"tools": [TOOL]}}
    if method == "tools/call":
        params = request.get("params", {})
        if params.get("name") == TOOL["name"] and params.get("arguments") == {"batch_id": "B-204"}:
            return {**envelope, "result": {"structuredContent": EVIDENCE, "content": [{"type": "text", "text": json.dumps(EVIDENCE)}], "isError": False}}
        return {**envelope, "error": {"code": -32602, "message": "Unknown tool or batch; only synthetic B-204 is available"}}
    return {**envelope, "error": {"code": -32601, "message": "Method not found"}}
