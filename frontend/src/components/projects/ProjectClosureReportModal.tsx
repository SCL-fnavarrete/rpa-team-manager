import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, List, Modal, Space, Table, Tag, Typography, message, theme } from 'antd';
import type { TableColumnsType } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, DownloadOutlined, WarningOutlined } from '@ant-design/icons';
import { apiService } from '@/services/api';
import { EmptyState, InlineErrorState, LoadingState } from '@/components/common/FeedbackStates';
import { formatCLP, formatPercent, formatSpanishNumber } from '@/utils';
import type { ClosureChecklistItem, ClosureReport } from '@/types/closureReport';

const { Text, Title } = Typography;

const NOT_RECORDED = 'sin registrar';
const NO_DATA = '—';

const PROJECT_STATUS_LABEL: Record<string, string> = {
  planning: 'Planificación',
  active: 'Activo',
  on_hold: 'En pausa',
  completed: 'Completado',
  cancelled: 'Cancelado'
};

const chileDateParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Fecha AAAA-MM-DD (inicio y término del proyecto) como DD/MM/AAAA, sin pasar por zonas horarias. */
const formatDay = (value: string): string => value.slice(0, 10).split('-').reverse().join('/');

/** Instante ISO o timestamp UTC de SQLite ("AAAA-MM-DD HH:MM:SS") como DD/MM/AAAA en hora de Chile, igual que el PDF. */
const formatTimestamp = (value: string): string => {
  const instant = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(instant.getTime())) return formatDay(value);
  const parts = Object.fromEntries(chileDateParts.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year}`;
};

/** Diferencia con signo explícito; el signo sale del valor ya redondeado para no mostrar "+0" ni "-0". */
const formatSigned = (value: number, decimals: number, format: (n: number) => string): string => {
  const rounded = Number(value.toFixed(decimals));
  return `${rounded > 0 ? '+' : rounded < 0 ? '-' : ''}${format(Math.abs(rounded))}`;
};

const scheduleLabel = ({ start_date, end_date }: ClosureReport['project']): string =>
  start_date || end_date
    ? `Inicio: ${start_date ? formatDay(start_date) : NOT_RECORDED} — Término: ${end_date ? formatDay(end_date) : NOT_RECORDED}`
    : 'Fechas: sin registrar';

interface ComparisonRow {
  key: string;
  label: string;
  quoted: number | null;
  real: number;
  decimals: number;
  format: (value: number) => string;
  formatDiff?: (value: number) => string;
}

type TeamRow = ClosureReport['team'][number] & { key: number };

const buildComparison = ({ quoted, actual }: ClosureReport): ComparisonRow[] => [
  { key: 'sale', label: 'Venta', quoted: quoted.amount_clp, real: actual.sale_price, decimals: 0, format: formatCLP },
  { key: 'cost', label: 'Costo', quoted: quoted.estimated_cost_clp, real: actual.real_cost, decimals: 0, format: formatCLP },
  { key: 'hours', label: 'Horas', quoted: quoted.hours, real: actual.approved_hours, decimals: 2, format: (value) => formatSpanishNumber(value) },
  {
    key: 'margin',
    label: 'Margen',
    quoted: quoted.margin_percent,
    real: actual.real_margin_percentage,
    decimals: 1,
    format: (value) => formatPercent(value),
    formatDiff: (value) => `${formatSpanishNumber(value, { decimals: 1 })} pp`
  }
];

/** Mensaje y tono de la alerta de pendientes; ya cerradas las finanzas, "listo para cerrar" deja de tener sentido. */
const closureAlert = ({ project, can_close_financials }: ClosureReport): { type: 'success' | 'warning'; message: string } => {
  if (project.financial_closed_at) {
    return { type: 'success', message: `Cierre financiero completado el ${formatTimestamp(project.financial_closed_at)}` };
  }
  return can_close_financials
    ? { type: 'success', message: 'Sin pendientes bloqueantes para el cierre financiero' }
    : { type: 'warning', message: 'Aún hay pendientes bloqueantes para el cierre financiero' };
};

const pendingLabel = (count: number): string => (count === 0 ? 'Sin pendientes' : `${count} ${count === 1 ? 'pendiente' : 'pendientes'}`);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section>
    <Title level={5} style={{ margin: '0 0 8px' }}>{title}</Title>
    {children}
  </section>
);

interface ProjectClosureReportModalProps {
  projectId: number;
  open: boolean;
  onClose: () => void;
}

export const ProjectClosureReportModal: React.FC<ProjectClosureReportModalProps> = ({ projectId, open, onClose }) => {
  const { token } = theme.useToken();
  const [report, setReport] = useState<ClosureReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setError(null);
    try {
      const result = await apiService.getClosureReport(projectId);
      if (requestId === latestRequest.current) setReport(result);
    } catch (err: any) {
      if (requestId === latestRequest.current) setError(err?.response?.data?.error || 'No se pudo generar el informe de cierre.');
    }
  }, [projectId]);

  // Cada apertura pide el informe de nuevo: sus cifras cambian con las facturas y horas del proyecto.
  useEffect(() => {
    if (!open) return undefined;
    void load();
    return () => {
      latestRequest.current += 1;
      setReport(null);
      setError(null);
    };
  }, [open, load]);

  // El endpoint exige el token de autenticación: un enlace directo no lo envía, así que se baja como blob.
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const blob = await apiService.downloadClosureReportPdf(projectId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `informe-cierre-${projectId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      message.error('No se pudo descargar el informe de cierre');
    } finally {
      setDownloading(false);
    }
  };

  const checklistIcon = (item: ClosureChecklistItem) => {
    if (item.ok) return <CheckCircleOutlined style={{ color: token.colorSuccess }} />;
    return item.blocking
      ? <CloseCircleOutlined style={{ color: token.colorError }} />
      : <WarningOutlined style={{ color: token.colorWarning }} />;
  };

  const renderContent = (current: ClosureReport) => {
    const { project, quoted, actual } = current;
    const hasQuote = quoted.version !== null;
    const closure = closureAlert(current);

    const comparison: TableColumnsType<ComparisonRow> = [
      { title: 'Concepto', dataIndex: 'label', key: 'label' },
      {
        title: 'Cotizado',
        key: 'quoted',
        align: 'right',
        render: (_: unknown, row) => (hasQuote && row.quoted !== null ? row.format(row.quoted) : <Text type="secondary">{NO_DATA}</Text>)
      },
      { title: 'Real', key: 'real', align: 'right', render: (_: unknown, row) => row.format(row.real) },
      {
        title: 'Diferencia',
        key: 'difference',
        align: 'right',
        render: (_: unknown, row) => (hasQuote && row.quoted !== null
          ? formatSigned(row.real - row.quoted, row.decimals, row.formatDiff ?? row.format)
          : <Text type="secondary">{NO_DATA}</Text>)
      }
    ];

    const team: TableColumnsType<TeamRow> = [
      { title: 'Persona', dataIndex: 'user_name', key: 'user_name' },
      { title: 'Horas presupuestadas', dataIndex: 'budgeted_hours', key: 'budgeted_hours', align: 'right', render: (value: number) => formatSpanishNumber(value) },
      { title: 'Horas reales', dataIndex: 'actual_hours', key: 'actual_hours', align: 'right', render: (value: number) => formatSpanishNumber(value) }
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Space direction="vertical" size={2}>
          <Text>Cliente: {project.client_name ?? 'Sin cliente'} · Comercial: {project.sales_rep_name ?? 'Sin asignar'}</Text>
          <Text>Estado: {PROJECT_STATUS_LABEL[project.status] ?? project.status}</Text>
          <Text>{scheduleLabel(project)}</Text>
          <Text>Entrega aceptada: {project.delivery_accepted_at ? formatTimestamp(project.delivery_accepted_at) : 'Pendiente'}</Text>
          {!project.financial_closed_at && <Text>Cierre financiero: Pendiente</Text>}
        </Space>

        <Section title="Pendientes">
          <Alert type={closure.type} message={closure.message} showIcon style={{ marginBottom: 8 }} />
          <List
            size="small"
            dataSource={current.checklist}
            renderItem={(item) => (
              <List.Item key={item.key} data-testid={`checklist-${item.key}`}>
                <Space>
                  {checklistIcon(item)}
                  <Text>{item.label}</Text>
                </Space>
                <Space size={8}>
                  {!item.ok && (item.blocking
                    ? <Tag color="error" style={{ marginInlineEnd: 0 }}>Bloquea el cierre</Tag>
                    : <Tag color="warning" style={{ marginInlineEnd: 0 }}>Solo advertencia</Tag>)}
                  <Text type="secondary">{pendingLabel(item.pending_count)}</Text>
                </Space>
              </List.Item>
            )}
          />
        </Section>

        <Section title="Cotizado vs Real">
          <div data-testid="quoted-vs-real">
            <Table
              dataSource={buildComparison(current)}
              columns={comparison}
              rowKey="key"
              size="small"
              pagination={false}
              scroll={{ x: 460 }}
            />
          </div>
          <Space direction="vertical" size={2} style={{ marginTop: 8 }}>
            <Text type="secondary">{hasQuote ? `Cotización aprobada: versión ${quoted.version}` : 'Sin cotización aprobada'}</Text>
            {actual.real_hours_source === 'projected' && <Text type="warning">Real estimado: no hay horas aprobadas aún</Text>}
          </Space>
          <Descriptions size="small" column={{ xs: 1, sm: 3 }} style={{ marginTop: 12 }}>
            <Descriptions.Item label="Utilidad real">{formatCLP(actual.real_profit)}</Descriptions.Item>
            <Descriptions.Item label="Horas planificadas">{formatSpanishNumber(actual.planned_hours)}</Descriptions.Item>
            <Descriptions.Item label="Impacto del desvío">{formatSigned(actual.variance_impact, 0, formatCLP)}</Descriptions.Item>
          </Descriptions>
        </Section>

        <Section title="Equipo">
          <div data-testid="team-hours">
            <Table
              dataSource={current.team.map((member, index) => ({ ...member, key: index }))}
              columns={team}
              rowKey="key"
              size="small"
              pagination={false}
              scroll={{ x: 420 }}
              locale={{ emptyText: <EmptyState description="Sin personas asignadas ni horas aprobadas" /> }}
            />
          </div>
        </Section>
      </div>
    );
  };

  const renderBody = () => {
    if (error) return <InlineErrorState title="No se pudo cargar el informe de cierre" description={error} onRetry={() => void load()} />;
    if (!report) return <LoadingState tip="Generando informe de cierre…" minHeight={240} />;
    return renderContent(report);
  };

  return (
    <Modal
      title={report ? `Informe de cierre · ${report.project.name}` : 'Informe de cierre'}
      open={open}
      onCancel={onClose}
      width={820}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      footer={[
        <Button key="pdf" type="primary" icon={<DownloadOutlined />} loading={downloading} disabled={!report} onClick={() => void handleDownload()}>
          Descargar PDF
        </Button>,
        <Button key="close" onClick={onClose}>Cerrar</Button>
      ]}
    >
      {renderBody()}
    </Modal>
  );
};
