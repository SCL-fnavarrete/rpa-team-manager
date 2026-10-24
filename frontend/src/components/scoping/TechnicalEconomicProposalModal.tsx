import React, { useEffect } from 'react';
import {
  Modal,
  Typography,
  Row,
  Col,
  Card,
  Table,
  Tag,
  Button,
  Descriptions,
  Alert,
  Tooltip,
  theme
} from 'antd';
import {
  PrinterOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  RiseOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import { ScopingCalculationResult, ScopingInputs, ViabilityStatus } from '../../types/scoping';
import { formatSpanishNumber } from '../../utils/numberFormat';
import {
  applicationsLabel,
  dataInputLabel,
  formatMoney,
  formatQuoteDate,
  frequencyLabel,
  paybackLabel
} from '../../utils/scopingFormat';

const { Text, Title, Paragraph } = Typography;

// Clase del <body> mientras se imprime: la hoja de estilos (index.css, @media print) deja visible solo `.proposal-print-area`
const PRINT_BODY_CLASS = 'proposal-printing';
const setPrintMode = (on: boolean) => document.body.classList.toggle(PRINT_BODY_CLASS, on);

// Tono de la leyenda cuando el proceso no es viable: sin automatización posible o poco viable es un error; los casos
// que se resuelven digitalizando o esperando son una advertencia
const NOT_VIABLE_TONE: Partial<Record<ViabilityStatus, 'error' | 'warning'>> = {
  not_viable: 'error',
  low_viability: 'error',
  digitize_first: 'warning',
  postpone: 'warning'
};

interface TechnicalEconomicProposalModalProps {
  visible: boolean;
  onClose: () => void;
  inputs: ScopingInputs;
  calculation: ScopingCalculationResult;
  // Código y fecha del levantamiento guardado; sin ellos la propuesta es un borrador sin guardar (con la fecha de hoy)
  quoteCode?: string;
  quoteDate?: string;
  // Sin esta función (rol sin permiso o levantamiento aún sin guardar) no se ofrece convertir
  onConvertToProject?: () => void;
  isConverting?: boolean;
}

export const TechnicalEconomicProposalModal: React.FC<TechnicalEconomicProposalModalProps> = ({
  visible,
  onClose,
  inputs,
  calculation,
  quoteCode,
  quoteDate,
  onConvertToProject,
  isConverting = false
}) => {
  const { token } = theme.useToken();
  const isDark = typeof document !== 'undefined' && (
    document.documentElement.dataset.theme === 'dark' ||
    token.colorBgBase === '#0F0F10' ||
    token.colorBgContainer === '#171718' ||
    token.colorBgElevated === '#262626'
  );

  // El backend solo convierte lo exactamente "viable" (409 en cualquier otro caso)
  const isViable = calculation.viability_status === 'viable';
  const notViableTone = NOT_VIABLE_TONE[calculation.viability_status] ?? 'error';
  const legendColor = isViable ? token.colorSuccess : notViableTone === 'warning' ? token.colorWarning : token.colorError;
  const assumptionsNumber = isViable ? 4 : 3;
  const proposalDate = formatQuoteDate(quoteDate) || formatQuoteDate(new Date().toISOString());

  // Con la propuesta abierta, Ctrl+P y el botón imprimen solo la propuesta
  useEffect(() => {
    if (!visible) return undefined;
    const enable = () => setPrintMode(true);
    const disable = () => setPrintMode(false);
    window.addEventListener('beforeprint', enable);
    window.addEventListener('afterprint', disable);
    return () => {
      window.removeEventListener('beforeprint', enable);
      window.removeEventListener('afterprint', disable);
      disable();
    };
  }, [visible]);

  // El modo de impresión se apaga con `afterprint`: algunos navegadores devuelven de print() antes de dibujar la hoja
  const handlePrint = () => {
    setPrintMode(true);
    window.print();
  };

  const phaseColumns = [
    {
      title: '#',
      dataIndex: 'phase_number',
      key: 'phase_number',
      width: 45,
      render: (num: number) => <Text strong>{num}</Text>
    },
    {
      title: 'Fase de Implementación',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: any) => (
        <div>
          <Text strong>{name}</Text>
          <div style={{ fontSize: 12 }}>
            <Text type="secondary">{record.description}</Text>
          </div>
        </div>
      )
    },
    {
      title: 'Cronograma',
      key: 'weeks',
      width: 130,
      render: (_: any, record: any) => (
        <Tag icon={<CalendarOutlined />} color="blue">
          Semana {record.start_week} a {record.end_week}
        </Tag>
      )
    },
    {
      title: 'HH Estimadas',
      dataIndex: 'hours',
      key: 'hours',
      width: 110,
      align: 'right' as const,
      render: (hours: number, record: any) => (
        <Text strong>
          {`${formatSpanishNumber(hours)} HH`} <Text type="secondary" style={{ fontSize: 11 }}>({`${formatSpanishNumber(record.percentage)}%`})</Text>
        </Text>
      )
    }
  ];

  const roleColumns = [
    {
      title: 'Código',
      dataIndex: 'role_code',
      key: 'role_code',
      width: 80,
      render: (code: string) => <Tag color="geekblue">{code}</Tag>
    },
    {
      title: 'Perfil Profesional Requerido',
      dataIndex: 'role_name',
      key: 'role_name',
      render: (name: string) => <Text strong>{name}</Text>
    },
    {
      title: 'Dedicación (FTE)',
      dataIndex: 'fte_equivalent',
      key: 'fte_equivalent',
      width: 140,
      render: (fte: number) => <Text>{`${formatSpanishNumber(fte)} FTE`}</Text>
    },
    {
      title: 'Horas Asignadas',
      dataIndex: 'total_hours',
      key: 'total_hours',
      width: 130,
      align: 'right' as const,
      render: (hours: number, record: any) => (
        <Text strong>
          {`${formatSpanishNumber(hours)} HH`} <Text type="secondary" style={{ fontSize: 11 }}>({`${formatSpanishNumber(record.percentage)}%`})</Text>
        </Text>
      )
    }
  ];

  const convertButton = onConvertToProject && (
    <Tooltip
      key="convert"
      title={isViable ? undefined : 'Solo se puede convertir en proyecto un levantamiento viable para RPA'}
    >
      {/* El span permite mostrar el aviso aunque el botón esté deshabilitado */}
      <span>
        <Button
          type="primary"
          icon={<RocketOutlined />}
          loading={isConverting}
          disabled={!isViable}
          onClick={onConvertToProject}
        >
          Convertir en Proyecto Formal
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Modal
      title={null}
      open={visible}
      onCancel={onClose}
      width={980}
      footer={[
        <Button key="close" onClick={onClose}>
          Cerrar
        </Button>,
        <Button key="print" icon={<PrinterOutlined />} onClick={handlePrint}>
          Imprimir / Exportar PDF
        </Button>,
        convertButton
      ]}
      styles={{ body: { padding: '24px 32px' } }}
    >
      {/* Todo lo que va dentro es lo que se imprime: ver `@media print` en index.css */}
      <div className="proposal-print-area">
        {/* Membrete Oficial de la Propuesta */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          borderBottom: `2px solid ${token.colorPrimary}`,
          paddingBottom: 16,
          marginBottom: 20
        }}>
          <div>
            <Text strong style={{ fontSize: 13, textTransform: 'uppercase', color: token.colorPrimary, letterSpacing: 1 }}>
              Propuesta Técnico - Económica de Automatización
            </Text>
            <Title level={3} style={{ margin: '4px 0 0 0' }}>
              {inputs.process_name || 'Automatización Robótica de Procesos (RPA)'}
            </Title>
            <Text type="secondary">
              Cliente: <Text strong>{inputs.client_name || 'Cliente Prospecto'}</Text>
              {inputs.business_unit ? ` | Unidad: ${inputs.business_unit}` : ''}
            </Text>
          </div>
          <div style={{ textAlign: 'right' }}>
            <Tag color={quoteCode ? 'blue' : 'default'} style={{ fontSize: 14, padding: '4px 10px' }}>
              {quoteCode || 'Borrador sin guardar'}
            </Tag>
            <div style={{ marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {`Fecha: ${proposalDate}`}
              </Text>
            </div>
          </div>
        </div>

        {/* 1. Resumen Ejecutivo y Diagnóstico */}
        <div style={{ marginBottom: 24 }}>
          <Title level={4} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SafetyCertificateOutlined style={{ color: token.colorPrimary }} />
            1. Diagnóstico de Viabilidad y Alcance
          </Title>
          <Paragraph type="secondary" style={{ fontSize: 14, lineHeight: 1.6 }}>
            A partir de la reunión de levantamiento técnico, se evaluó la idoneidad del proceso bajo el estándar de automatización robótica (RPA).
            {isViable && (
              <>
                {' '}El proceso ha sido calificado como <Text strong style={{ color: legendColor }}>{calculation.viability_label.toUpperCase()}</Text>,
                {' '}clasificado en un nivel de <Text strong>{calculation.effort_label}</Text>.
              </>
            )}
          </Paragraph>

          {!isViable && (
            <Alert
              type={notViableTone}
              showIcon
              style={{ marginBottom: 12 }}
              message={<Text strong style={{ color: legendColor }}>{calculation.viability_label.toUpperCase()}</Text>}
              description={
                <div>
                  {calculation.blockers.length > 0 && (
                    <ul style={{ margin: '4px 0 8px 0', paddingLeft: 18 }}>
                      {calculation.blockers.map((blocker, idx) => (
                        <li key={idx}>{blocker}</li>
                      ))}
                    </ul>
                  )}
                  <Text>No se presenta oferta económica ni retorno mientras el proceso no sea viable para RPA.</Text>
                </div>
              }
            />
          )}

          <Descriptions
            bordered
            size="small"
            column={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 2, xxl: 2 }}
            style={{ marginTop: 12 }}
          >
            <Descriptions.Item label="Sistemas Involucrados">
              {inputs.applications_detail
                ? `${inputs.applications_detail} (${applicationsLabel(inputs.applications_count)})`
                : applicationsLabel(inputs.applications_count)}
            </Descriptions.Item>
            <Descriptions.Item label="Entrada de Datos">
              {dataInputLabel(inputs.data_input_type)}
            </Descriptions.Item>
            <Descriptions.Item label="Entorno Tecnológico">
              {inputs.uses_vdi ? 'Citrix / VDI (Superficie)' : 'Nativo Windows / Web'}
            </Descriptions.Item>
            <Descriptions.Item label="Frecuencia">
              {`${frequencyLabel(inputs.frequency)} (${formatSpanishNumber(inputs.volume_per_frequency)} transacciones/ciclo)`}
            </Descriptions.Item>
            <Descriptions.Item label="AHT Actual">
              {`${formatSpanishNumber(inputs.aht_minutes)} min por caso`}
            </Descriptions.Item>
            <Descriptions.Item label="Horas Manuales Anuales">
              <Text strong>{`${formatSpanishNumber(calculation.annual_manual_hours)} h/año`}</Text>
            </Descriptions.Item>
          </Descriptions>
        </div>

        {/* 2. Cronograma y Cubicación de Esfuerzo */}
        <div style={{ marginBottom: 24 }}>
          <Title level={4} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClockCircleOutlined style={{ color: token.colorPrimary }} />
            2. Cubicación de Esfuerzo y Cronograma de Trabajo
          </Title>
          <Paragraph type="secondary" style={{ fontSize: 13 }}>
            El proyecto contempla una duración total estimada de <Text strong>{calculation.estimated_weeks} semanas</Text> y un esfuerzo total de <Text strong>{formatSpanishNumber(calculation.total_hours)} Horas Hombre (HH)</Text>, distribuidas a lo largo de 5 fases metodológicas:
          </Paragraph>

          <Table
            columns={phaseColumns}
            dataSource={calculation.phases_breakdown}
            rowKey="phase_number"
            pagination={false}
            size="small"
            bordered
            style={{ marginBottom: 16 }}
          />

          <Text strong style={{ fontSize: 13 }}>Distribución por Perfiles del Equipo de Proyecto:</Text>
          <Table
            columns={roleColumns}
            dataSource={calculation.roles_breakdown}
            rowKey="role_code"
            pagination={false}
            size="small"
            bordered
            style={{ marginTop: 8 }}
          />
        </div>

        {/* 3. Propuesta Económica y Retorno de Inversión: solo si el proceso es viable */}
        {isViable && (
        <div style={{ marginBottom: 24 }}>
          <Title level={4} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RiseOutlined style={{ color: token.colorPrimary }} />
            3. Oferta Económica y Análisis de Retorno (ROI)
          </Title>

          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Card
                styles={{ body: { padding: 16 } }}
                style={{
                  backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : token.colorFillAlter,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  height: '100%'
                }}
              >
                <Text type="secondary" style={{ fontSize: 12 }}>VALOR TOTAL DEL PROYECTO</Text>
                <Title level={2} style={{ margin: '4px 0 10px 0', color: token.colorPrimary }}>
                  {formatMoney(calculation.proposed_price, calculation.currency)}
                </Title>
                <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">Total Horas Hombre:</Text>
                    <Text strong>{`${formatSpanishNumber(calculation.total_hours)} HH`}</Text>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">Tarifa promedio:</Text>
                    <Text>{`${formatMoney(calculation.target_hourly_rate, calculation.currency)}/h`}</Text>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">Forma de Pago sugerida:</Text>
                    <Text>30% Inicio / 40% UAT / 30% Pase Producción</Text>
                  </div>
                </div>
              </Card>
            </Col>

            <Col xs={24} md={12}>
              <Card
                styles={{ body: { padding: 16 } }}
                style={{
                  backgroundColor: token.colorSuccessBg,
                  border: `1px solid ${token.colorSuccess}`,
                  height: '100%'
                }}
              >
                <Text type="secondary" style={{ fontSize: 12 }}>RETORNO ESTIMADO PARA EL CLIENTE</Text>
                <Title level={2} style={{ margin: '4px 0 10px 0', color: token.colorSuccess }}>
                  {formatMoney(calculation.client_annual_savings, calculation.currency)}
                  <Text type="secondary" style={{ fontSize: 13, fontWeight: 'normal' }}> / año</Text>
                </Title>
                <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">Horas liberadas al año:</Text>
                    <Text strong>{`${formatSpanishNumber(calculation.hours_saved_annual)} h`}</Text>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">Reducción de errores humanos:</Text>
                    <Text strong style={{ color: token.colorSuccess }}>{`~${formatSpanishNumber(calculation.error_reduction_pct)}%`}</Text>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">Recuperación de inversión (Payback):</Text>
                    <Text strong style={{ color: token.colorPrimary }}>
                      {paybackLabel(calculation)}
                    </Text>
                  </div>
                </div>
              </Card>
            </Col>
          </Row>
        </div>
        )}

        {/* Supuestos y Exclusiones Clave */}
        <div>
          <Title level={4} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <InfoCircleOutlined style={{ color: token.colorWarning }} />
            {`${assumptionsNumber}. Supuestos, Requisitos y Exclusiones`}
          </Title>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Card
                title={<Text strong style={{ fontSize: 13 }}>Supuestos y Requisitos Clave</Text>}
                size="small"
                styles={{ body: { padding: 12 } }}
                style={{ border: `1px solid ${token.colorBorderSecondary}` }}
              >
                <Paragraph style={{ whiteSpace: 'pre-line', margin: 0, fontSize: 12 }}>
                  {inputs.assumptions ||
                    '1. El cliente proporcionará credenciales y ambientes de prueba (QA) con antelación.\n' +
                    '2. Accesos a través de VPN estables y sin autenticación biométrica o token físico no automatizable.\n' +
                    '3. Disponibilidad del responsable del proceso para reuniones de validación y UAT.'}
                </Paragraph>
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card
                title={<Text strong style={{ fontSize: 13 }}>Exclusiones del Alcance</Text>}
                size="small"
                styles={{ body: { padding: 12 } }}
                style={{ border: `1px solid ${token.colorBorderSecondary}` }}
              >
                <Paragraph style={{ whiteSpace: 'pre-line', margin: 0, fontSize: 12 }}>
                  {inputs.exclusions ||
                    '1. Modificaciones en el código fuente de los sistemas destino o ERP del cliente.\n' +
                    '2. Migraciones mayores de bases de datos o sistemas durante el periodo de construcción.'}
                </Paragraph>
              </Card>
            </Col>
          </Row>
        </div>
      </div>
    </Modal>
  );
};
