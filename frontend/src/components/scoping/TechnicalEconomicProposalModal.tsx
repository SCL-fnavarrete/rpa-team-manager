import React from 'react';
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
import { ScopingCalculationResult, ScopingInputs } from '../../types/scoping';

const { Text, Title, Paragraph } = Typography;

interface TechnicalEconomicProposalModalProps {
  visible: boolean;
  onClose: () => void;
  inputs: ScopingInputs;
  calculation: ScopingCalculationResult;
  quoteCode?: string;
  onConvertToProject?: () => void;
  isConverting?: boolean;
}

export const TechnicalEconomicProposalModal: React.FC<TechnicalEconomicProposalModalProps> = ({
  visible,
  onClose,
  inputs,
  calculation,
  quoteCode = 'COT-2026-BORRADOR',
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

  const formatCurrency = (val: number, cur: string) => {
    return `${cur} ${val.toLocaleString('es-CL')}`;
  };

  const handlePrint = () => {
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
          {hours} HH <Text type="secondary" style={{ fontSize: 11 }}>({record.percentage}%)</Text>
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
      render: (fte: number) => <Text>{fte} FTE-mes</Text>
    },
    {
      title: 'Horas Asignadas',
      dataIndex: 'total_hours',
      key: 'total_hours',
      width: 130,
      align: 'right' as const,
      render: (hours: number, record: any) => (
        <Text strong>
          {hours} HH <Text type="secondary" style={{ fontSize: 11 }}>({record.percentage}%)</Text>
        </Text>
      )
    }
  ];

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
        onConvertToProject && (
          <Button
            key="convert"
            type="primary"
            icon={<RocketOutlined />}
            loading={isConverting}
            onClick={onConvertToProject}
          >
            Convertir en Proyecto Formal
          </Button>
        )
      ]}
      styles={{ body: { padding: '24px 32px' } }}
    >
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
          <Tag color="blue" style={{ fontSize: 14, padding: '4px 10px' }}>
            {quoteCode}
          </Tag>
          <div style={{ marginTop: 6 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Fecha: {new Date().toLocaleDateString('es-CL')}
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
          El proceso ha sido calificado como <Text strong style={{ color: token.colorSuccess }}>{calculation.viability_label.toUpperCase()}</Text>, 
          clasificado en un nivel de <Text strong>{calculation.effort_label}</Text>.
        </Paragraph>

        <Descriptions 
          bordered 
          size="small" 
          column={{ xs: 1, sm: 2, md: 3 }}
          style={{ marginTop: 12 }}
        >
          <Descriptions.Item label="Sistemas Involucrados">
            {inputs.applications_detail || `${inputs.applications_count.replace('_', ' ')}`}
          </Descriptions.Item>
          <Descriptions.Item label="Entrada de Datos">
            {inputs.data_input_type === 'digital_structured' ? 'Digital Estructurada' : 'Digital Mixta'}
          </Descriptions.Item>
          <Descriptions.Item label="Entorno Tecnológico">
            {inputs.uses_vdi ? 'Citrix / VDI (Superficie)' : 'Nativo Windows / Web'}
          </Descriptions.Item>
          <Descriptions.Item label="Frecuencia">
            {inputs.frequency.toUpperCase()} ({inputs.volume_per_frequency} transacciones/ciclo)
          </Descriptions.Item>
          <Descriptions.Item label="AHT Actual">
            {inputs.aht_minutes} min por caso
          </Descriptions.Item>
          <Descriptions.Item label="Horas Manuales Anuales">
            <Text strong>{calculation.annual_manual_hours.toLocaleString()} h/año</Text>
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
          El proyecto contempla una duración total estimada de <Text strong>{calculation.estimated_weeks} semanas</Text> y un esfuerzo total de <Text strong>{calculation.total_hours} Horas Hombre (HH)</Text>, distribuidas a lo largo de 5 fases metodológicas:
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

      {/* 3. Propuesta Económica y Retorno de Inversión */}
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
                {formatCurrency(calculation.proposed_price, calculation.currency)}
              </Title>
              <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Total Horas Hombre:</Text>
                  <Text strong>{calculation.total_hours} HH</Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Tarifa promedio:</Text>
                  <Text>{formatCurrency(calculation.target_hourly_rate, calculation.currency)}/h</Text>
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
                backgroundColor: isDark ? 'rgba(82, 196, 26, 0.05)' : '#f6ffed',
                border: `1px solid ${token.colorSuccess}`,
                height: '100%'
              }}
            >
              <Text type="secondary" style={{ fontSize: 12 }}>RETORNO ESTIMADO PARA EL CLIENTE</Text>
              <Title level={2} style={{ margin: '4px 0 10px 0', color: token.colorSuccess }}>
                {formatCurrency(calculation.client_annual_savings, calculation.currency)}
                <Text type="secondary" style={{ fontSize: 13, fontWeight: 'normal' }}> / año</Text>
              </Title>
              <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Horas liberadas al año:</Text>
                  <Text strong>{calculation.hours_saved_annual.toLocaleString()} h</Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Reducción de errores humanos:</Text>
                  <Text strong style={{ color: token.colorSuccess }}>~{calculation.error_reduction_pct}%</Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Recuperación de inversión (Payback):</Text>
                  <Text strong style={{ color: token.colorPrimary }}>
                    {calculation.payback_months > 0 ? `${calculation.payback_months} meses` : 'Inmediato'}
                  </Text>
                </div>
              </div>
            </Card>
          </Col>
        </Row>
      </div>

      {/* 4. Supuestos y Exclusiones Clave */}
      <div>
        <Title level={4} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <InfoCircleOutlined style={{ color: token.colorWarning }} />
          4. Supuestos, Requisitos y Exclusiones
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
    </Modal>
  );
};
