"""In-process pub/sub for Server-Sent Events (see main.py's /api/events).

Uses stdlib queue.Queue, not asyncio.Queue -- every route handler that would
publish an event (push_upstream_dataset in main.py) is a sync `def`, which
FastAPI runs in a worker thread, not the event loop thread. queue.Queue is
thread-safe to put() from there; asyncio.Queue is not.
"""
import queue
import threading

_subscribers = set()
_lock = threading.Lock()


def subscribe():
    q = queue.Queue()
    with _lock:
        _subscribers.add(q)
    return q


def unsubscribe(q):
    with _lock:
        _subscribers.discard(q)


def publish(event):
    with _lock:
        subs = list(_subscribers)
    for q in subs:
        q.put(event)
