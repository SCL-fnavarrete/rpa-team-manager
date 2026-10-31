import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Col, Row, Select, Space, Spin, Statistic, Table, Tag, Tooltip, Typography, theme } from 'antd';
import type { TableColumnsType } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { apiService } from '@/services/api';
import { EmptyState, InlineErrorState, LoadingState } from '@/components/common/FeedbackStates';
import { formatCLP, formatPercent, formatSpanishNumber, getProjectStatusColor } from '@/utils';
import { isSaleRealized } from '@/utils/saleRealization';
import { ProjectStatusLabels } from '@/types/project';
import type {
  PortfolioCommercialStage,
  PortfolioFilters,
  PortfolioHealthSemaphore,
  PortfolioPipelineItem,
  PortfolioResult,
  PortfolioRow,
  PortfolioSalesByRep
} from '@/types/portfolio';

const { Text, Title } = Typography;

interface FilterOption { value: number; label: string }

const STAGE_OPTIONS: { value: PortfolioCommercialStage; label: string }[] = [
  { value: 'quoting', label: 'En cotización' },
  { value: 'approved', label: 'Aprobado' },
  { value: 'lost', label: 'Oportunidad perdida' }
];

const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGE_OPTIONS.map(({ value, label }) => [value, label]));
const STAGE_COLOR: Record<string, string> = { quoting: 'gold', approved: 'green', lost: 'default' };

const SEMAPHORE: Record<PortfolioHealthSemaphore, { status: 'success' | 'warning' | 'error' | 'default'; label: string }> = {
  green: { status: 'success', label: 'En curso' },
  yellow: { status: 'warning', label: 'En riesgo' },
  red: { status: 'error', label: 'Desviado' },
  gray: { status: 'default', label: 'Sin datos' }
};

const REALIZED_ONLY_NOTE = 'Solo proyectos con OK del cliente';
const ALL_PROJECTS_NOTE = 'Incluye todos los proyectos de la cartera';
const UNASSIGNED = 'Sin asignar';
const FINANCIAL_COLUMNS_COUNT = 5;

const estimatedCostNote = (count: number): string =>
  `Incluye ${count} ${count === 1 ? 'proyecto' : 'proyectos'} con costo estimado (sin horas aprobadas)`;

const loadDirectory = async (url: string): Promise<FilterOption[]> => {
  try {
    const response = await apiService.get<{ data?: { id: number; name: string }[] }>(url);
    return (response?.data ?? []).map(({ id, name }) => ({ value: id, label: name }));
  } catch (error) {
    console.warn(`No se pudo cargar el filtro ${url}:`, error);
    return [];
  }
};

interface KpiCardProps {
  id: string;
  title: string;
  value: number;
  note: string;
  extraNote?: string;
  format?: (value: number) => string;
}

const KpiCard: React.FC<KpiCardProps> = ({ id, title, value, note, extraNote, format = formatCLP }) => {
  const { token } = theme.useToken();
  return (
    <Card data-testid={`kpi-${id}`} styles={{ body: { padding: 18 } }} style={{ borderColor: token.colorBorderSecondary }}>
      <Statistic title={title} value={value} formatter={(val) => format(Number(val))} valueStyle={{ fontSize: 22, fontWeight: 700 }} />
      <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextSecondary }}>{note}</div>
      {extraNote && <div style={{ marginTop: 2, fontSize: 12, color: token.colorWarning }}>{extraNote}</div>}
    </Card>
  );
};

interface FilterSelectProps<T extends number | string> {
  label: string;
  ariaLabel: string;
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (value: T | undefined) => void;
}

function FilterSelect<T extends number | string>({ label, ariaLabel, value, options, onChange }: FilterSelectProps<T>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
      <Select<T>
        allowClear
        showSearch
        optionFilterProp="label"
        placeholder="Todos"
        aria-label={ariaLabel}
        value={value}
        options={options}
        onChange={onChange}
        style={{ width: '100%' }}
      />
    </div>
  );
}

export const PortfolioPage: React.FC = () => {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<PortfolioFilters>({});
  const [data, setData] = useState<PortfolioResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<FilterOption[]>([]);
  const [salesReps, setSalesReps] = useState<FilterOption[]>([]);
  const [areas, setAreas] = useState<FilterOption[]>([]);
  const latestRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadDirectory('/clients'), loadDirectory('/sales-reps'), loadDirectory('/business-areas')])
      .then(([clientOptions, salesRepOptions, areaOptions]) => {
        if (cancelled) return;
        setClients(clientOptions);
        setSalesReps(salesRepOptions);
        setAreas(areaOptions);
      });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async (current: PortfolioFilters) => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await apiService.getPortfolio(current);
      if (requestId === latestRequest.current) setData(result);
    } catch (err: any) {
      // Sin respuesta del servidor (p. ej. el 429 que api.ts traduce) el mensaje viene en el propio error
      if (requestId === latestRequest.current) setError(err?.response?.data?.error ?? err?.message ?? 'No se pudo cargar la cartera de proyectos.');
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(filters); }, [filters, load]);

  const setFilter = <K extends keyof PortfolioFilters>(key: K, value: PortfolioFilters[K] | undefined) =>
    setFilters((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });

  const projectCell = (name: string, projectId: number, detail: string) => (
    <div>
      <Button type="link" style={{ padding: 0, fontWeight: 600, height: 'auto', textAlign: 'left' }} onClick={() => navigate(`/projects/${projectId}`)}>
        {name}
      </Button>
      <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{detail}</div>
    </div>
  );

  const money = (value: number) => <span style={{ whiteSpace: 'nowrap' }}>{formatCLP(value)}</span>;
  const signedColor = (value: number) => (value < 0 ? token.colorError : undefined);

  // Con financials_error la primera cifra ocupa todas las columnas financieras con el aviso.
  const financialSpan = (first: boolean) => (row: PortfolioRow) => ({
    colSpan: row.financials_error ? (first ? FINANCIAL_COLUMNS_COUNT : 0) : 1
  });

  const projectColumns: TableColumnsType<PortfolioRow> = [
    {
      title: 'Proyecto',
      dataIndex: 'project_name',
      key: 'project_name',
      width: 240,
      render: (name: string, row) => projectCell(name, row.project_id, `${row.client_name ?? 'Sin cliente'} · ${row.area_name ?? 'Sin área'}`)
    },
    {
      title: 'Comercial',
      dataIndex: 'sales_rep_name',
      key: 'sales_rep_name',
      render: (name: string | null) => (name ? name : <Text type="secondary">{UNASSIGNED}</Text>)
    },
    {
      title: 'Etapa',
      key: 'stage',
      render: (_: unknown, row) => (
        <Space direction="vertical" size={4} align="start">
          <Tag color={STAGE_COLOR[row.commercial_stage] ?? 'default'} style={{ marginInlineEnd: 0 }}>
            {STAGE_LABEL[row.commercial_stage] ?? row.commercial_stage}
          </Tag>
          <Tag color={getProjectStatusColor(row.status)} style={{ marginInlineEnd: 0 }}>
            {(ProjectStatusLabels as Record<string, string>)[row.status] ?? row.status}
          </Tag>
        </Space>
      )
    },
    {
      title: 'Salud',
      dataIndex: 'health_semaphore',
      key: 'health_semaphore',
      render: (semaphore: PortfolioHealthSemaphore) => <Badge status={SEMAPHORE[semaphore].status} text={SEMAPHORE[semaphore].label} />
    },
    {
      title: 'Venta',
      dataIndex: 'sale_price',
      key: 'sale_price',
      align: 'right',
      onCell: financialSpan(true),
      render: (value: number, row) => row.financials_error
        ? <Tag color="warning" icon={<ExclamationCircleOutlined />}>Datos incompletos</Tag>
        : money(value)
    },
    {
      title: 'Costo real',
      dataIndex: 'real_cost',
      key: 'real_cost',
      align: 'right',
      onCell: financialSpan(false),
      render: (value: number, row) => (
        <Space size={6} wrap={false}>
          {row.real_hours_source === 'projected' && (
            <Tooltip title="Sin horas aprobadas: se usa el costo planificado">
              <Tag color="warning" style={{ marginInlineEnd: 0 }}>estimado</Tag>
            </Tooltip>
          )}
          {money(value)}
        </Space>
      )
    },
    { title: 'Costo proyectado', dataIndex: 'projected_cost', key: 'projected_cost', align: 'right', onCell: financialSpan(false), render: money },
    {
      title: 'Utilidad proyectada',
      dataIndex: 'projected_profit',
      key: 'projected_profit',
      align: 'right',
      onCell: financialSpan(false),
      render: (value: number) => <span style={{ whiteSpace: 'nowrap', color: signedColor(value) }}>{formatCLP(value)}</span>
    },
    {
      title: 'Margen proyectado',
      dataIndex: 'projected_margin_percentage',
      key: 'projected_margin_percentage',
      align: 'right',
      onCell: financialSpan(false),
      render: (value: number) => <span style={{ color: signedColor(value) }}>{formatPercent(value)}</span>
    },
    { title: 'Facturado', dataIndex: 'invoiced_clp', key: 'invoiced_clp', align: 'right', render: money },
    { title: 'Cobrado', dataIndex: 'collected_clp', key: 'collected_clp', align: 'right', render: money },
    {
      title: 'Por facturar',
      dataIndex: 'pending_to_invoice_clp',
      key: 'pending_to_invoice_clp',
      align: 'right',
      render: (value: number, row) => (!isSaleRealized(row) || row.financials_error ? <Text type="secondary">—</Text> : money(value))
    }
  ];

  const pipelineColumns: TableColumnsType<PortfolioPipelineItem> = [
    {
      title: 'Proyecto',
      dataIndex: 'project_name',
      key: 'project_name',
      render: (name: string, row) => projectCell(name, row.project_id, row.client_name ?? 'Sin cliente')
    },
    {
      title: 'Comercial',
      dataIndex: 'sales_rep_name',
      key: 'sales_rep_name',
      render: (name: string | null) => (name ? name : <Text type="secondary">{UNASSIGNED}</Text>)
    },
    {
      title: 'Última cotización',
      dataIndex: 'last_quote_amount_clp',
      key: 'last_quote_amount_clp',
      align: 'right',
      render: (value: number, row) => (row.last_quote_version === null ? <Text type="secondary">Sin cotización</Text> : money(value))
    },
    {
      title: 'Versión',
      dataIndex: 'last_quote_version',
      key: 'last_quote_version',
      render: (version: number | null) => (version === null ? <Text type="secondary">—</Text> : `v${version}`)
    }
  ];

  const salesColumns: TableColumnsType<PortfolioSalesByRep> = [
    {
      title: 'Comercial',
      dataIndex: 'sales_rep_name',
      key: 'sales_rep_name',
      render: (name: string, row) => (row.sales_rep_id === null ? <Text type="secondary">{name || UNASSIGNED}</Text> : name)
    },
    { title: 'Proyectos', dataIndex: 'projects', key: 'projects', align: 'right' },
    { title: 'Venta', dataIndex: 'sale_price', key: 'sale_price', align: 'right', render: money }
  ];

  const renderContent = () => {
    if (error) return <InlineErrorState title="No se pudo cargar la cartera" description={error} onRetry={() => void load(filters)} />;
    if (!data) return <LoadingState tip="Cargando cartera de proyectos…" minHeight={320} />;

    const { totals } = data;
    const hasActiveFilters = Object.keys(filters).length > 0;
    // Los proyectos sin OK del cliente no suman al costo real total, así que tampoco cuentan en su aviso.
    const estimatedCostProjects = data.rows.filter((row) => isSaleRealized(row) && !row.financials_error && row.real_hours_source === 'projected').length;
    return (
      <Spin spinning={loading}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard id="projects" title="Proyectos" value={totals.projects} note={ALL_PROJECTS_NOTE} format={formatSpanishNumber} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard id="sale_price" title="Venta total" value={totals.sale_price} note={REALIZED_ONLY_NOTE} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard id="real_cost" title="Costo real" value={totals.real_cost} note={REALIZED_ONLY_NOTE} extraNote={estimatedCostProjects > 0 ? estimatedCostNote(estimatedCostProjects) : undefined} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard id="projected_cost" title="Costo proyectado" value={totals.projected_cost} note={REALIZED_ONLY_NOTE} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard id="projected_profit" title="Utilidad proyectada" value={totals.projected_profit} note={REALIZED_ONLY_NOTE} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard id="invoiced" title="Facturado" value={totals.invoiced_clp} note={ALL_PROJECTS_NOTE} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard id="collected" title="Cobrado" value={totals.collected_clp} note={ALL_PROJECTS_NOTE} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard id="pending_to_invoice" title="Por facturar" value={totals.pending_to_invoice_clp} note={REALIZED_ONLY_NOTE} />
            </Col>
          </Row>

          <Card title="Proyectos" styles={{ body: { padding: 16 } }} style={{ borderColor: token.colorBorderSecondary }}>
            <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 14 }}>
              Los proyectos en cotización, perdidos o cancelados se muestran atenuados y no suman a los totales de venta, costos ni por facturar.
            </Text>
            <Table
              dataSource={data.rows}
              columns={projectColumns}
              rowKey="project_id"
              size="middle"
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              scroll={{ x: 1500 }}
              onRow={(row) => (isSaleRealized(row) ? {} : { style: { opacity: 0.6 } })}
              locale={{ emptyText: <EmptyState description={hasActiveFilters ? 'No hay proyectos en la cartera con estos filtros' : 'Aún no hay proyectos'} /> }}
            />
          </Card>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Card data-testid="pipeline" title="Pipeline en cotización" styles={{ body: { padding: 16 } }} style={{ borderColor: token.colorBorderSecondary, height: '100%' }}>
                <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 14 }}>
                  Proyectos en cotización con el monto de su última versión. Respeta los filtros de cliente, comercial y área, pero no el de etapa.
                </Text>
                <Table
                  dataSource={data.pipeline}
                  columns={pipelineColumns}
                  rowKey="project_id"
                  size="middle"
                  pagination={{ pageSize: 5, hideOnSinglePage: true }}
                  scroll={{ x: 520 }}
                  locale={{ emptyText: <EmptyState description="No hay proyectos en cotización" /> }}
                />
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card data-testid="sales-by-rep" title="Ventas por comercial" styles={{ body: { padding: 16 } }} style={{ borderColor: token.colorBorderSecondary, height: '100%' }}>
                <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 14 }}>
                  {REALIZED_ONLY_NOTE}.
                </Text>
                <Table
                  dataSource={data.sales_by_rep}
                  columns={salesColumns}
                  rowKey={(row) => row.sales_rep_id ?? 'sin-asignar'}
                  size="middle"
                  pagination={false}
                  scroll={{ x: 360 }}
                  locale={{ emptyText: <EmptyState description="Aún no hay ventas por comercial" /> }}
                />
              </Card>
            </Col>
          </Row>
        </div>
      </Spin>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <Text className="section-kicker">CONTROL</Text>
        <Title level={2} style={{ margin: '4px 0 6px', fontSize: 24 }}>Cartera de proyectos</Title>
        <Text type="secondary">Venta, costo, margen, salud y facturación de todos los proyectos en una sola vista.</Text>
      </div>

      <Card styles={{ body: { padding: 16 } }} style={{ borderColor: token.colorBorderSecondary }}>
        <Space wrap size={[16, 12]} align="end">
          <FilterSelect label="Cliente" ariaLabel="Filtrar por cliente" value={filters.client_id} options={clients} onChange={(value) => setFilter('client_id', value)} />
          <FilterSelect label="Comercial" ariaLabel="Filtrar por comercial" value={filters.sales_rep_id} options={salesReps} onChange={(value) => setFilter('sales_rep_id', value)} />
          <FilterSelect label="Etapa comercial" ariaLabel="Filtrar por etapa" value={filters.commercial_stage} options={STAGE_OPTIONS} onChange={(value) => setFilter('commercial_stage', value)} />
          <FilterSelect label="Área de negocio" ariaLabel="Filtrar por área" value={filters.area_id} options={areas} onChange={(value) => setFilter('area_id', value)} />
        </Space>
      </Card>

      {renderContent()}
    </div>
  );
};
