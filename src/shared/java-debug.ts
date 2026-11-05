/** Add remote JVM debugging to Spring's application process, preserving other JVM options. */
export function springDebugArgs(args: readonly string[], port = 5005): string[] {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Use uma porta entre 1024 e 65535.');
  const prefix = '-Dspring-boot.run.jvmArguments=';
  const index = args.findIndex((arg) => arg.startsWith(prefix));
  const existing = args[index]?.slice(prefix.length) ?? '';
  if (existing.includes('jdwp')) return [...args];
  const option = '-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:' + port;
  const value = prefix + (existing ? existing + ' ' : '') + option;
  return index < 0 ? [...args, value] : args.map((arg, i) => (i === index ? value : arg));
}
