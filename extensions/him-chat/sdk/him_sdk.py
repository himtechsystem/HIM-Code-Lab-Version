# =============================================================================
# HIM Code Python SDK - Pre-injected into Python REPL
# This code is automatically loaded when HIM Code starts a Python execution
# =============================================================================

import sys
import os
import json
import subprocess
import traceback

# Output marker for streaming communication with Node.js
def _him_output(action, data):
    """Internal: Send structured output to Node.js"""
    payload = json.dumps({"action": action, "data": data}, ensure_ascii=False)
    print(f"HIM_STREAM: {payload}", flush=True)

def _him_error(msg):
    """Internal: Send error to Node.js"""
    _him_output("error", str(msg))

# =============================================================================
# Public API Functions
# =============================================================================

def him_say(message):
    """
    Send a message to the chat UI for display.
    This allows AI to output text in real-time during code execution.
    
    Args:
        message: The text message to display in the chat
    """
    try:
        _him_output("say", str(message))
    except Exception as e:
        print(f"[HIM SDK Error in him_say]: {e}", file=sys.stderr)

def him_read_file(path):
    """
    Read the contents of a file.
    
    Args:
        path: File path to read (absolute or relative to cwd)
    
    Returns:
        str: File contents, or error message if failed
    """
    try:
        abs_path = os.path.abspath(path) if not os.path.isabs(path) else path
        with open(abs_path, 'r', encoding='utf-8') as f:
            content = f.read()
        _him_output("file_read", {"path": abs_path, "content": content})
        return content
    except FileNotFoundError:
        msg = f"File not found: {path}"
        _him_error(msg)
        return msg
    except Exception as e:
        msg = f"Error reading {path}: {e}"
        _him_error(msg)
        return msg

def him_write_file(path, content):
    """
    Write content to a file.
    
    Args:
        path: File path to write (absolute or relative to cwd)
        content: Content to write
    
    Returns:
        str: Success message or error
    """
    try:
        abs_path = os.path.abspath(path) if not os.path.isabs(path) else path
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, 'w', encoding='utf-8') as f:
            f.write(content)
        _him_output("file_written", {"path": abs_path, "size": len(content)})
        return f"File written: {abs_path} ({len(content)} bytes)"
    except Exception as e:
        msg = f"Error writing {path}: {e}"
        _him_error(msg)
        return msg

def him_execute(command):
    """
    Execute a shell command and return the output.
    
    Args:
        command: Shell command string to execute
    
    Returns:
        str: Command output or error
    """
    try:
        _him_output("execute_start", command)
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=60
        )
        output = result.stdout
        if result.stderr:
            output += "\n[STDERR]\n" + result.stderr
        _him_output("execute_done", {
            "command": command,
            "output": output,
            "returncode": result.returncode
        })
        return output
    except subprocess.TimeoutExpired:
        msg = "Command timed out after 60 seconds"
        _him_error(msg)
        return msg
    except Exception as e:
        msg = f"Execute error: {e}"
        _him_error(msg)
        return msg

def him_list_dir(path="."):
    """
    List contents of a directory.
    
    Args:
        path: Directory path (default: current directory)
    
    Returns:
        list: Directory contents with type info
    """
    try:
        abs_path = os.path.abspath(path) if not os.path.isabs(path) else path
        items = []
        for name in os.listdir(abs_path):
            full_path = os.path.join(abs_path, name)
            is_dir = os.path.isdir(full_path)
            items.append({
                "name": name,
                "type": "dir" if is_dir else "file",
                "size": os.path.getsize(full_path) if not is_dir else 0
            })
        _him_output("dir_list", {"path": abs_path, "items": items})
        return items
    except Exception as e:
        msg = f"Error listing {path}: {e}"
        _him_error(msg)
        return msg

def him_get_cwd():
    """Get current working directory"""
    return os.getcwd()

def him_set_cwd(path):
    """Change current working directory"""
    try:
        abs_path = os.path.abspath(path) if not os.path.isabs(path) else path
        os.chdir(abs_path)
        _him_output("cwd_changed", abs_path)
        return abs_path
    except Exception as e:
        msg = f"Error changing directory: {e}"
        _him_error(msg)
        return msg

# =============================================================================
# Error Handler - Ensures process never crashes
# =============================================================================

class HIMError(Exception):
    """Base exception for HIM Code operations"""
    pass

class HIMFileError(HIMError):
    """File operation error"""
    pass

class HIMExecuteError(HIMError):
    """Command execution error"""
    pass

# Install global exception handler
_old_excepthook = sys.excepthook

def _him_excepthook(exc_type, exc_value, exc_traceback):
    """Global exception handler - prevents process from crashing"""
    if issubclass(exc_type, HIMError):
        _him_output("error", str(exc_value))
    else:
        tb_str = ''.join(traceback.format_exception(exc_type, exc_value, exc_traceback))
        _him_output("exception", {
            "type": exc_type.__name__,
            "message": str(exc_value),
            "traceback": tb_str
        })

sys.excepthook = _him_excepthook

# =============================================================================
# Initialization Complete
# =============================================================================

_him_output("init", {
    "version": "1.0.0",
    "python_version": sys.version,
    "cwd": os.getcwd()
})

# Make functions easily accessible
__all__ = [
    'him_say', 'him_read_file', 'him_write_file', 'him_execute',
    'him_list_dir', 'him_get_cwd', 'him_set_cwd',
    'HIMError', 'HIMFileError', 'HIMExecuteError'
]

print("[HIM SDK] Loaded successfully. Available functions:", file=sys.stderr)
print("  him_say(message)         - Send message to chat", file=sys.stderr)
print("  him_read_file(path)      - Read file content", file=sys.stderr)
print("  him_write_file(path, content) - Write file", file=sys.stderr)
print("  him_execute(command)     - Run shell command", file=sys.stderr)
print("  him_list_dir(path)       - List directory", file=sys.stderr)
print("  him_get_cwd()            - Get current directory", file=sys.stderr)
print("  him_set_cwd(path)         - Change directory", file=sys.stderr)
print("[HIM SDK] Ready!", file=sys.stderr)
