# Runs inside the session container for each preview connection: bridges
# stdin/stdout to a TCP port on the container's localhost.
import os, socket, sys, threading

sock = socket.create_connection(("127.0.0.1", int(sys.argv[1])))

def upstream():
    while True:
        data = os.read(0, 65536)
        if not data:
            break
        sock.sendall(data)
    try:
        sock.shutdown(socket.SHUT_WR)
    except OSError:
        pass

threading.Thread(target=upstream, daemon=True).start()
while True:
    data = sock.recv(65536)
    if not data:
        break
    os.write(1, data)
