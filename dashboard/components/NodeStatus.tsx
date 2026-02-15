const nodes = [
  { name: "Jetson Orin", role: "YOLO inference", status: "pending" },
  { name: "Orange Pi", role: "TBD", status: "offline" },
  { name: "Spark", role: "TBD", status: "offline" },
];

export default function NodeStatus() {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-zinc-100">Nodes</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {nodes.map((node) => (
          <div
            key={node.name}
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
          >
            <p className="font-medium text-zinc-200">{node.name}</p>
            <p className="text-sm text-zinc-500">{node.role}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
