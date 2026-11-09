import { useEffect, useRef } from "react";
import * as echarts from "echarts";

type ChartEvents = Record<string, (params: unknown) => void>;

interface ChartProps {
  option: echarts.EChartsOption;
  className?: string;
  /** ECharts 事件回调（键集合须稳定，如 { click: fn }），handler 变化不重绑 */
  onEvents?: ChartEvents;
}

/** ECharts 轻量封装：实例只创建一次，option 变化走 setOption（保留内置过渡动画）。 */
export function Chart({ option, className, onEvents }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const onEventsRef = useRef(onEvents);
  onEventsRef.current = onEvents;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = echarts.init(container);
    chartRef.current = chart;

    const observer = new ResizeObserver(() => {
      // observe 首次注册也会回调一次；尺寸未变时不 resize，避免打断进行中的入场动画
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0 && (w !== chart.getWidth() || h !== chart.getHeight())) {
        chart.resize();
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // 事件只注册一次，回调从 ref 取最新实现
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const names = Object.keys(onEventsRef.current ?? {});
    for (const name of names) {
      chart.on(name, (params: unknown) => onEventsRef.current?.[name]?.(params));
    }
    return () => {
      for (const name of names) chart.off(name);
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option);
  }, [option]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
