"use client";

import { useSyncExternalStore } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

const areaColors = [
  "#047857",
  "#0369a1",
  "#b45309",
  "#7c3aed",
  "#be123c",
  "#0f766e",
  "#4f46e5",
  "#ca8a04",
  "#475569",
];

const axisStyle = { fontSize: 12, fill: "#475569" };

export function DashboardCharts({
  porArea,
  porSituacao,
  evolucaoMensal,
}: {
  porArea: Array<{ area: string; autorizado: number; empenhado: number; pago: number }>;
  porSituacao: Array<{ situacao: string; quantidade: number; valor: number }>;
  evolucaoMensal: Array<{ mes: string; empenhado: number; liquidado: number; pago: number }>;
}) {
  const isClient = useIsClient();

  if (!isClient) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPlaceholder title="Emendas por area" />
        <ChartPlaceholder title="Situacao das emendas" />
        <ChartPlaceholder className="lg:col-span-2" title="Evolucao dos empenhos" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent>
          <h2 className="text-base font-bold text-slate-950">Emendas por area</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porArea.slice(0, 8)} margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="area" tick={axisStyle} tickLine={false} />
                <YAxis
                  tick={axisStyle}
                  tickFormatter={(value) => `${Number(value) / 1000}k`}
                  tickLine={false}
                />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Legend />
                <Bar dataKey="autorizado" name="Autorizado" fill="#0369a1" radius={4} />
                <Bar dataKey="empenhado" name="Empenhado" fill="#047857" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h2 className="text-base font-bold text-slate-950">Situacao das emendas</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={porSituacao}
                  dataKey="quantidade"
                  innerRadius={58}
                  nameKey="situacao"
                  outerRadius={94}
                  paddingAngle={3}
                >
                  {porSituacao.map((entry, index) => (
                    <Cell
                      fill={areaColors[index % areaColors.length]}
                      key={entry.situacao}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardContent>
          <h2 className="text-base font-bold text-slate-950">Evolucao dos empenhos</h2>
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={evolucaoMensal} margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="mes" tick={axisStyle} tickLine={false} />
                <YAxis
                  tick={axisStyle}
                  tickFormatter={(value) => `${Number(value) / 1000}k`}
                  tickLine={false}
                />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Legend />
                <Bar dataKey="empenhado" name="Empenhado" fill="#047857" radius={4} />
                <Bar dataKey="liquidado" name="Liquidado" fill="#0369a1" radius={4} />
                <Bar dataKey="pago" name="Pago" fill="#b45309" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ChartPlaceholder({
  title,
  className,
}: {
  title: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent>
        <h2 className="text-base font-bold text-slate-950">{title}</h2>
        <div className="mt-4 h-72 rounded-md bg-slate-100" />
      </CardContent>
    </Card>
  );
}

function useIsClient() {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}
