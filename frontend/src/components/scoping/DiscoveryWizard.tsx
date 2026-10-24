import React, { useState } from 'react';
import { 
  Form, 
  Input, 
  InputNumber, 
  Select, 
  Radio, 
  Switch, 
  Row, 
  Col, 
  Card, 
  Typography, 
  Space, 
  Divider, 
  Alert, 
  Tag, 
  Tabs,
  Tooltip,
  theme 
} from 'antd';
import { 
  SafetyCertificateOutlined, 
  DesktopOutlined, 
  RiseOutlined, 
  DollarOutlined, 
  InfoCircleOutlined,
  QuestionCircleOutlined,
  LockOutlined,
  FilePdfOutlined
} from '@ant-design/icons';
import { 
  ScopingInputs, 
  RPAArchetype, 
  DataInputType, 
  RuleBasedLevel, 
  ProcessStability, 
  ProcessFrequency, 
  StepsCount, 
  DecisionComplexity, 
  ApplicationsCount, 
  StructuredDataPct 
} from '../../types/scoping';

const { Text, Title } = Typography;
const { TextArea } = Input;

// Campos que se guardan y se muestran en la propuesta pero que el motor no usa en ningún número
const REFERENCE_ONLY_HINT = 'Solo referencia, no afecta el cálculo';

interface DiscoveryWizardProps {
  form: any;
  inputs: ScopingInputs;
  onValuesChange: (changedValues: any, allValues: any) => void;
  selectedArchetype?: RPAArchetype;
  customHoursEnabled: boolean;
  onCustomHoursToggle: (enabled: boolean) => void;
}

export const DiscoveryWizard: React.FC<DiscoveryWizardProps> = ({
  form,
  inputs,
  onValuesChange,
  selectedArchetype,
  customHoursEnabled,
  onCustomHoursToggle
}) => {
  const { token } = theme.useToken();
  const isDark = typeof document !== 'undefined' && (
    document.documentElement.dataset.theme === 'dark' ||
    token.colorBgBase === '#0F0F10' ||
    token.colorBgContainer === '#171718' ||
    token.colorBgElevated === '#262626'
  );

  const [activeTab, setActiveTab] = useState<string>('gate0');

  // Las tarifas se rotulan con la moneda elegida; las UF llevan decimales
  const currency = inputs.currency ?? 'CLP';
  const rateStep = currency === 'UF' ? 0.01 : 1;

  // Atajos rápidos de aplicaciones comunes
  const commonApps = ['SAP S/4HANA', 'SAP GUI', 'Microsoft Dynamics 365', 'Softland', 'Defontana', 'Portal SII', 'Excel', 'Outlook', 'Chrome / Web B2B'];

  const handleAddAppTag = (appName: string) => {
    const current = form.getFieldValue('applications_detail') || '';
    if (!current.includes(appName)) {
      const next = current ? `${current}, ${appName}` : appName;
      form.setFieldsValue({ applications_detail: next });
      onValuesChange({ applications_detail: next }, form.getFieldsValue());
    }
  };

  return (
    <Card 
      styles={{ body: { padding: '16px 20px' } }}
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : token.colorBgContainer
      }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        type="card"
        items={[
          {
            key: 'gate0',
            forceRender: true,
            label: (
              <span title="Minutos 1-4: Factibilidad y Gate 0">
                <SafetyCertificateOutlined />
                1 Factibilidad
              </span>
            ),
            children: (
              <div style={{ paddingTop: 8 }}>
                {/* Preguntas recomendadas del arquetipo si está activo */}
                {selectedArchetype && selectedArchetype.recommended_questions.length > 0 && (
                  <Alert
                    type="info"
                    showIcon
                    icon={<QuestionCircleOutlined />}
                    message={<Text strong>Preguntas clave para {selectedArchetype.name}:</Text>}
                    description={
                      <ul style={{ margin: '4px 0 0 0', paddingLeft: 18, fontSize: 12 }}>
                        {selectedArchetype.recommended_questions.map((q, idx) => (
                          <li key={idx}>{q}</li>
                        ))}
                      </ul>
                    }
                    style={{ marginBottom: 16 }}
                  />
                )}

                <Row gutter={[16, 12]}>
                  <Col xs={24} sm={12}>
                    <Form.Item 
                      label={<Text strong>Nombre del Cliente / Empresa</Text>}
                      name="client_name"
                      rules={[{ required: true, message: 'Ingresa el nombre del cliente' }]}
                    >
                      <Input placeholder="Ej: Banco Santander, Cencosud, Agrosuper..." />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item 
                      label={<Text strong>Nombre del Proceso</Text>}
                      name="process_name"
                      rules={[{ required: true, message: 'Ingresa el nombre del proceso' }]}
                    >
                      <Input placeholder="Ej: Conciliación Bancaria Diaria, Contabilización Facturas..." />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item label="Unidad de Negocio / Área" name="business_unit">
                      <Input placeholder="Ej: Tesorería, Contabilidad, Operaciones, Ventas..." />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item label="Contacto / Responsable Cliente" name="client_contact">
                      <Input placeholder="Ej: Juan Pérez - Jefe de Tesorería" />
                    </Form.Item>
                  </Col>
                </Row>

                <Divider style={{ margin: '14px 0' }} />

                <Title level={5} style={{ marginBottom: 12 }}>
                  Filtro de Eliminación (Gate 0)
                </Title>

                <Row gutter={[16, 12]}>
                  <Col xs={24} md={12}>
                    <Form.Item 
                      label={
                        <Space>
                          <Text strong>Tipo de Entrada de Datos</Text>
                          <Tooltip title="Digital y estructurado es óptimo para RPA. Documentos en papel físico requieren digitalización previa.">
                            <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                          </Tooltip>
                        </Space>
                      }
                      name="data_input_type"
                      rules={[{ required: true }]}
                    >
                      <Select<DataInputType>
                        options={[
                          { value: 'digital_structured', label: '✅ Digital y Estructurada (Excel, BDD, XML, Web)' },
                          { value: 'digital_unstructured', label: '⚠️ Digital y No Estructurada (Email libre, chat, reportes sin plantilla)' },
                          { value: 'non_digital_structured', label: '⛔ No Digital y Estructurada (Formularios físicos en papel) -> Digitalizar 1°' },
                          { value: 'non_digital_unstructured', label: '❌ No Digital y No Estructurada (Notas manuscritas) -> No Automatizable' }
                        ]}
                      />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item 
                      label={
                        <Space>
                          <Text strong>Nivel de Reglas vs Juicio Humano</Text>
                          <Tooltip title="RPA es ideal para tareas basadas en reglas. Procesos con alta subjetividad tienen baja viabilidad.">
                            <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                          </Tooltip>
                        </Space>
                      }
                      name="rule_based_level"
                      rules={[{ required: true }]}
                    >
                      <Select<RuleBasedLevel>
                        options={[
                          { value: 'rules_exclusive', label: 'Exclusivamente basado en reglas fijas' },
                          { value: 'rules_mostly', label: 'Mayormente basado en reglas (algunas excepciones)' },
                          { value: 'some_subjectivity', label: 'Algún nivel de criterio humano acotado' },
                          { value: 'mostly_subjective', label: 'Mayormente subjetivo / a criterio del analista' },
                          { value: 'purely_subjective', label: 'Completamente subjetivo (No viable para RPA)' }
                        ]}
                      />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item 
                      label={
                        <Space>
                          <Text strong>Estabilidad del Proceso (próximos 6 meses)</Text>
                          <Tooltip title="Si se esperan cambios legislativos o de modelo de negocio significativos, se recomienda posponer la automatización.">
                            <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                          </Tooltip>
                        </Space>
                      }
                      name="process_stability"
                      rules={[{ required: true }]}
                    >
                      <Select<ProcessStability>
                        options={[
                          { value: 'no_change', label: 'Sin cambios previstos (Estable)' },
                          { value: 'very_small', label: 'Cambio muy pequeño' },
                          { value: 'some_change', label: 'Algún cambio moderado' },
                          { value: 'medium_change', label: 'Cambio medio' },
                          { value: 'significant_change', label: 'Cambio significativo (Posponer)' }
                        ]}
                      />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item 
                      label={
                        <Space>
                          <Text strong>Estabilidad de Aplicaciones / ERP (próximos 6 meses)</Text>
                          <Tooltip title="¿Habrá migración de ERP (ej. a SAP S/4HANA o Dynamics) o cambio de interfaz en 6 meses?">
                            <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                          </Tooltip>
                        </Space>
                      }
                      name="application_stability"
                      rules={[{ required: true }]}
                    >
                      <Select<ProcessStability>
                        options={[
                          { value: 'no_change', label: 'Sin cambios previstos (Estable)' },
                          { value: 'very_small', label: 'Cambio muy pequeño' },
                          { value: 'some_change', label: 'Algún cambio moderado' },
                          { value: 'medium_change', label: 'Cambio medio' },
                          { value: 'significant_change', label: 'Cambio significativo / Migración (Posponer)' }
                        ]}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </div>
            )
          },
          {
            key: 'systems',
            forceRender: true,
            label: (
              <span title="Minutos 5-8: Sistemas y complejidad">
                <DesktopOutlined />
                2 Sistemas
              </span>
            ),
            children: (
              <div style={{ paddingTop: 8 }}>
                <Row gutter={[16, 12]}>
                  <Col xs={24}>
                    <Form.Item 
                      label={<Text strong>Sistemas y Aplicaciones involucradas</Text>}
                      name="applications_detail"
                    >
                      <Input placeholder="Ej: SAP S/4HANA, Dynamics 365, Portal SII, Excel de Cuadratura..." />
                    </Form.Item>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: -8, marginBottom: 12 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>Atajos rápidos:</Text>
                      {commonApps.map((app) => (
                        <Tag 
                          key={app} 
                          style={{ cursor: 'pointer' }}
                          onClick={() => handleAddAppTag(app)}
                        >
                          + {app}
                        </Tag>
                      ))}
                    </div>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item 
                      label={<Text strong>Cantidad de Aplicaciones</Text>}
                      name="applications_count"
                      rules={[{ required: true }]}
                    >
                      <Select<ApplicationsCount>
                        options={[
                          { value: '1_app', label: '1 sola aplicación' },
                          { value: '2_3_apps', label: '2 a 3 aplicaciones' },
                          { value: '4_5_apps', label: '4 a 5 aplicaciones' },
                          { value: 'gt_5_apps', label: 'Más de 5 aplicaciones' }
                        ]}
                      />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item 
                      label={<Text strong>Número Estimado de Pasos</Text>}
                      name="process_steps_count"
                      rules={[{ required: true }]}
                    >
                      <Select<StepsCount>
                        options={[
                          { value: 'lte_10', label: 'Menos de 10 pasos (Muy simple)' },
                          { value: '10_15', label: '10 a 15 pasos' },
                          { value: '15_25', label: '15 a 25 pasos' },
                          { value: '25_40', label: '25 a 40 pasos' },
                          { value: 'gt_40', label: 'Más de 40 pasos (Complejo)' }
                        ]}
                      />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item 
                      label={<Text strong>Dificultad de Decisiones / Lógica</Text>}
                      name="decision_complexity"
                      rules={[{ required: true }]}
                    >
                      <Select<DecisionComplexity>
                        options={[
                          { value: 'linear', label: 'Lineal: no requiere tomar decisiones condicionales' },
                          { value: 'simple_yes_no', label: 'Decisiones simples (tipo Sí / No, montos > X)' },
                          { value: 'complex', label: 'Decisiones complejas con múltiples ramificaciones' }
                        ]}
                      />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item 
                      label={<Text strong>% Datos de Entrada Estructurados</Text>}
                      name="structured_data_pct"
                      rules={[{ required: true }]}
                    >
                      <Select<StructuredDataPct>
                        options={[
                          { value: 'gte_80', label: '>= 80% datos estructurados (tablas, campos fijos)' },
                          { value: '60_80', label: '60% a 80% estructurado' },
                          { value: '40_60', label: '40% a 60% estructurado' },
                          { value: 'lt_40', label: '< 40% estructurado (alto texto libre)' }
                        ]}
                      />
                    </Form.Item>
                  </Col>
                </Row>

                <Divider style={{ margin: '14px 0' }} />

                {/* Factores Multiplicadores Clave */}
                <Title level={5} style={{ marginBottom: 12 }}>
                  Factores que Elevan la Dificultad del Proceso
                </Title>

                <Row gutter={[16, 12]}>
                  <Col xs={24} md={12}>
                    <div style={{ 
                      padding: 12, 
                      borderRadius: 8, 
                      border: `1px solid ${token.colorBorderSecondary}`,
                      backgroundColor: inputs.uses_vdi 
                        ? token.colorWarningBg 
                        : (isDark ? 'rgba(255, 255, 255, 0.02)' : token.colorFillAlter)
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <Space size={6}>
                            <LockOutlined style={{ color: token.colorWarning }} />
                            <Text strong>¿Acceso por VDI / Citrix / RDP?</Text>
                          </Space>
                          <div style={{ fontSize: 12, marginTop: 4 }}>
                            <Text type="secondary">
                              Eleva el puntaje de dificultad (x1,6) por no disponer de selectores nativos del SO; puede subir el nivel de esfuerzo, pero no suma horas por sí solo.
                            </Text>
                          </div>
                        </div>
                        <Form.Item name="uses_vdi" valuePropName="checked" noStyle>
                          <Switch aria-label="Acceso por VDI / Citrix / RDP" />
                        </Form.Item>
                      </div>
                    </div>
                  </Col>

                  <Col xs={24} md={12}>
                    <div style={{ 
                      padding: 12, 
                      borderRadius: 8, 
                      border: `1px solid ${token.colorBorderSecondary}`,
                      backgroundColor: inputs.requires_ocr 
                        ? token.colorInfoBg 
                        : (isDark ? 'rgba(255, 255, 255, 0.02)' : token.colorFillAlter)
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <Space size={6}>
                            <FilePdfOutlined style={{ color: token.colorInfo }} />
                            <Text strong>¿Requiere OCR / Documentos Escaneados?</Text>
                          </Space>
                          <div style={{ fontSize: 12, marginTop: 4 }}>
                            <Text type="secondary">
                              Eleva el puntaje de dificultad (x1,2) por la calibración del motor documental y los modelos de extracción; puede subir el nivel de esfuerzo, pero no suma horas por sí solo.
                            </Text>
                          </div>
                        </div>
                        <Form.Item name="requires_ocr" valuePropName="checked" noStyle>
                          <Switch aria-label="Requiere OCR / documentos escaneados" />
                        </Form.Item>
                      </div>
                    </div>
                  </Col>
                </Row>
              </div>
            )
          },
          {
            key: 'volume',
            forceRender: true,
            label: (
              <span title="Minutos 9-12: Volumetría y ROI">
                <RiseOutlined />
                3 Volumetría
              </span>
            ),
            children: (
              <div style={{ paddingTop: 8 }}>
                <Row gutter={[16, 12]}>
                  <Col xs={24} md={8}>
                    <Form.Item 
                      label={<Text strong>Frecuencia de Ejecución</Text>}
                      name="frequency"
                      rules={[{ required: true }]}
                    >
                      <Select<ProcessFrequency>
                        options={[
                          { value: 'daily', label: 'Diario (260 días laborales/año)' },
                          { value: 'weekly', label: 'Semanal (52 veces/año)' },
                          { value: 'biweekly', label: 'Bi-semanal (26 veces/año)' },
                          { value: 'monthly', label: 'Mensual (12 veces/año)' },
                          { value: 'quarterly', label: 'Trimestral (4 veces/año)' },
                          { value: 'annual', label: 'Anual (1 vez/año)' }
                        ]}
                      />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={8}>
                    <Form.Item 
                      label={<Text strong>Volumen por Ciclo (Transacciones)</Text>}
                      name="volume_per_frequency"
                      rules={[{ required: true, message: 'Ingresa el volumen' }]}
                    >
                      <InputNumber 
                        min={1} 
                        style={{ width: '100%' }} 
                        placeholder="Ej: 250 facturas, 50 cartolas" 
                      />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={8}>
                    <Form.Item 
                      label={
                        <Space>
                          <Text strong>Tiempo Manual (AHT)</Text>
                          <Tooltip title="Tiempo promedio en minutos que demora un analista humano en procesar 1 caso completo.">
                            <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                          </Tooltip>
                        </Space>
                      }
                      name="aht_minutes"
                      rules={[{ required: true, message: 'Ingresa el tiempo manual (AHT)' }]}
                    >
                      <InputNumber 
                        min={0.1} 
                        step={0.5} 
                        style={{ width: '100%' }} 
                        addonAfter="minutos"
                      />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={8}>
                    <Form.Item 
                      label={<Text strong>Colaboradores Actuales (FTEs)</Text>}
                      name="current_ftes"
                      extra={REFERENCE_ONLY_HINT}
                    >
                      <InputNumber min={0.5} step={0.5} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={8}>
                    <Form.Item 
                      label={<Text strong>Tasa de Error Humano (%)</Text>}
                      name="error_rate_pct"
                      extra={REFERENCE_ONLY_HINT}
                    >
                      <InputNumber min={0} max={100} style={{ width: '100%' }} addonAfter="%" />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={8}>
                    <Form.Item 
                      label={<Text strong>Tasa de Excepciones (%)</Text>}
                      name="exception_rate_pct"
                    >
                      <InputNumber min={0} max={100} style={{ width: '100%' }} addonAfter="%" />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item 
                      label={<Text strong>Periodos Punta o Peak del Proceso</Text>}
                      name="peak_period"
                      extra={REFERENCE_ONLY_HINT}
                    >
                      <Select
                        options={[
                          { value: 'regular_peak', label: 'Regular (ej. Cierre de mes: dura días/semanas y aumenta >20%)' },
                          { value: 'rare_predictable', label: 'Evento predecible (vacaciones de invierno, cierre anual)' },
                          { value: 'rare_unpredictable', label: 'Evento impredecible de corta duración' },
                          { value: 'no_peaks', label: 'Flujo parejo, sin puntas' }
                        ]}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </div>
            )
          },
          {
            key: 'proposal',
            forceRender: true,
            label: (
              <span title="Minutos 13-15: Propuesta y cubicación">
                <DollarOutlined />
                4 Propuesta
              </span>
            ),
            children: (
              <div style={{ paddingTop: 8 }}>
                <Row gutter={[16, 12]}>
                  <Col xs={24} md={8}>
                    <Form.Item label={<Text strong>Moneda de Cotización</Text>} name="currency">
                      <Radio.Group buttonStyle="solid">
                        <Radio.Button value="CLP">CLP ($)</Radio.Button>
                        <Radio.Button value="USD">USD ($)</Radio.Button>
                        <Radio.Button value="UF">UF</Radio.Button>
                      </Radio.Group>
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={8}>
                    <Form.Item 
                      label={<Text strong>Tarifa Venta por Hora (Equipo RPA)</Text>}
                      name="target_hourly_rate"
                    >
                      <InputNumber min={0} step={rateStep} addonAfter={currency} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={8}>
                    <Form.Item 
                      label={
                        <Space>
                          <Text strong>Costo Hora Analista Cliente</Text>
                          <Tooltip title="Se utiliza para calcular cuánto gasta el cliente al año en este proceso y su ROI.">
                            <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                          </Tooltip>
                        </Space>
                      }
                      name="hourly_labor_cost"
                    >
                      <InputNumber min={0} step={rateStep} addonAfter={currency} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>

                <Divider style={{ margin: '14px 0' }} />

                {/* Opción de calibración fina de horas */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <Text strong>Calibración Manual de Horas (Opcional)</Text>
                    <div style={{ fontSize: 12 }}>
                      <Text type="secondary">
                        Por defecto, el motor cubica automáticamente según la matriz del caso real (Facturas / Scoring). Activa esto si deseas ajustar horas específicas por rol; los campos que dejes vacíos usan el valor calculado.
                      </Text>
                    </div>
                  </div>
                  <Switch aria-label="Calibración manual de horas" checked={customHoursEnabled} onChange={onCustomHoursToggle} />
                </div>

                {customHoursEnabled && (
                  <div style={{ 
                    padding: 12, 
                    borderRadius: 8, 
                    border: `1px solid ${token.colorBorderSecondary}`,
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.02)' : token.colorFillAlter,
                    marginBottom: 16
                  }}>
                    <Row gutter={[12, 12]}>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Semanas" name={['custom_hours', 'weeks']}>
                          <InputNumber min={1} max={520} precision={0} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={5}>
                        <Form.Item label="LP (Líder Proyecto)" name={['custom_hours', 'lp']}>
                          <InputNumber min={0} addonAfter="HH" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={5}>
                        <Form.Item label="CRPA (Arquitecto)" name={['custom_hours', 'crpa']}>
                          <InputNumber min={0} addonAfter="HH" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={5}>
                        <Form.Item label="AR (Desarrollador)" name={['custom_hours', 'ar']}>
                          <InputNumber min={0} addonAfter="HH" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={5}>
                        <Form.Item label="ADV (Advisor/QA)" name={['custom_hours', 'adv']}>
                          <InputNumber min={0} addonAfter="HH" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </div>
                )}

                <Row gutter={[16, 12]}>
                  <Col xs={24} md={12}>
                    <Form.Item label={<Text strong>Supuestos y Requisitos Clave</Text>} name="assumptions">
                      <TextArea rows={3} placeholder="Requisitos para el inicio del proyecto..." />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label={<Text strong>Exclusiones del Alcance</Text>} name="exclusions">
                      <TextArea rows={3} placeholder="Aspectos fuera del alcance de la automatización..." />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Form.Item label="Notas Internas de la Reunión" name="notes">
                      <TextArea rows={2} placeholder="Observaciones particulares del cliente, fechas tentativas de decisión..." />
                    </Form.Item>
                  </Col>
                </Row>
              </div>
            )
          }
        ]}
      />
    </Card>
  );
};
