import CameraFeed from "@/components/CameraFeed";
import DetectionPanel from "@/components/DetectionPanel";
import NodeStatus from "@/components/NodeStatus";
import SparkInference from "@/components/SparkInference";

export default function Home() {
  return (
    <div className="min-h-screen p-6 md:p-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
          LocalGuard
        </h1>
        <p className="text-sm text-zinc-500">Monitoring dashboard</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <CameraFeed />
          <SparkInference />
        </div>

        <div className="flex flex-col gap-6">
          <DetectionPanel />
          <NodeStatus />
        </div>
      </div>
    </div>
  );
}
