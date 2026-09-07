/* Synthetic executable only. Never authenticates or calls an inference API. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>

int main(int argc, char **argv) {
  if (argc != 2 || strcmp(argv[1], "--version") != 0) return 2;
  if (getenv("ANTHROPIC_API_KEY") || getenv("OPENAI_API_KEY") || getenv("NODE_OPTIONS")) return 3;
  int secret = open(PROTECTED_PATH, O_RDONLY);
  if (secret >= 0) { close(secret); return 4; }
  int socket_fd = socket(AF_INET, SOCK_STREAM, 0);
  if (socket_fd >= 0) {
    struct sockaddr_in address = {0};
    address.sin_family = AF_INET;
    address.sin_port = htons(PROBE_PORT);
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    int connected = connect(socket_fd, (struct sockaddr *)&address, sizeof(address));
    close(socket_fd);
    if (connected == 0) return 5;
  }
  puts("2.1.263 (Claude Code)");
  return 0;
}
