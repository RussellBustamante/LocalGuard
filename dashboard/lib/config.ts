function envOrDefault(key: string, fallback: string): string {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

// Dashboard base URL used by edge nodes (for example, voice context lookups).
export const DASHBOARD_URL = envOrDefault(
  "LOCALGUARD_DASHBOARD_URL",
  "http://192.168.50.1:3000"
);

// Jetson Nano — YOLO object detection
export const JETSON_URL = envOrDefault(
  "NEXT_PUBLIC_JETSON_URL",
  "http://192.168.50.4:8080"
);
export const JETSON_STREAM_URL = `${JETSON_URL}/stream`;
export const JETSON_DETECTIONS_URL = `${JETSON_URL}/detections`;

// DGX Spark — Vision-Language model
export const SPARK_URL = envOrDefault(
  "NEXT_PUBLIC_SPARK_URL",
  "http://192.168.50.2:8090"
);
export const SPARK_STREAM_URL = `${SPARK_URL}/stream`;
export const SPARK_RESULTS_URL = `${SPARK_URL}/results`;
export const SPARK_HEALTH_URL = `${SPARK_URL}/health`;

// Orange Pi — Voice Assistant
export const ORANGEPI_URL = envOrDefault(
  "NEXT_PUBLIC_ORANGEPI_URL",
  "http://192.168.50.3:8070"
);
export const ORANGEPI_HEALTH_URL = `${ORANGEPI_URL}/health`;
export const ORANGEPI_STATUS_URL = `${ORANGEPI_URL}/status`;
