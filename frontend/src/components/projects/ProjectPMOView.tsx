import { displayLabel } from '@/utils/displayLabels';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Row,
  Col,
  Statistic,
  Progress,
  Tag,
  Timeline,
  Space,
  Button,
  Alert,
  Typography,
  Tooltip,
  Divider,
  Empty,
  Spin,
  message
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  RiseOutlined,
  FallOutlined,
  WarningOutlined,
  TrophyOutlined,
  CalendarOutlined,
  FireOutlined,
  ThunderboltOutlined,
  EyeOutlined,
  FundOutlined,
  ExclamationCircleOutlined,
  SyncOutlined,
  PlusOutlined,
  DisconnectOutlined,
  DatabaseOutlined
} from '@ant-design/icons';
import apiService from '@/services/api';
import dayjs from 'dayjs';

const { Text } = Typography;

interface ProjectPMOViewProps {
  projectId: number;
  projectName: string;
  projectStatus?: string;
  startDate?: string;
  endDate?: string;
}

interface ErrorState {
  hasError: boolean;
  errorMessage: string;
  errorType: 'network' | 'permission' | 'data' | 'unknown';
}

interface PMOMetrics {
  completion_percentage: number;
  schedule_variance_days: number;
  // Solo lo envía el backend a team_lead
  cost_variance_percentage?: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  team_velocity: number;
  bugs_found: number;
  bugs_resolved: number;
  actual_hours: number;
  planned_hours: number;
}

interface Milestone {
  id: number;
  name: string;
  description: string;
  milestone_type: string;
  planned_date: string;
  actual_date: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'delayed' | 'cancelled';
  priority: 'critical' | 'high' | 'medium' | 'low';
  completion_percentage: number;
  responsibility: 'internal' | 'client' | 'external' | 'shared';
  delay_justification?: string;
  financial_impact?: number;
}

export const ProjectPMOView: React.FC<ProjectPMOViewProps> = ({
  projectId
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [pmoMetrics, setPmoMetrics] = useState<PMOMetrics | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [error, setError] = useState<ErrorState>({
    hasError: false,
    errorMessage: '',
    errorType: 'unknown'
  });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    loadPMOData();
  }, [projectId]);

  const loadPMOData = async () => {
    try {
      setLoading(true);
      setError({ hasError: false, errorMessage: '', errorType: 'unknown' });
      
      // Load PMO metrics for this specific project
      const pmoData = await apiService.getProjectPMOMetrics(projectId);
      
      if (pmoData && pmoData.project) {
        // Set PMO metrics from project data
        const project = pmoData.project;
        setPmoMetrics({
          completion_percentage: project.completion_percentage || 0,
          schedule_variance_days: project.schedule_variance_days || 0,
          cost_variance_percentage: project.cost_variance_percentage === undefined ? undefined : project.cost_variance_percentage || 0,
          risk_level: project.risk_level || 'low',
          team_velocity: project.team_velocity || 0,
          bugs_found: project.bugs_found || 0,
          bugs_resolved: project.bugs_resolved || 0,
          actual_hours: project.actual_hours || 0,
          planned_hours: project.planned_hours || 0
        });

        // Set milestones from PMO data
        if (pmoData.milestones && pmoData.milestones.list) {
          setMilestones(pmoData.milestones.list);
        }

        // Set gantt data if available (future implementation)
        // if (pmoData.gantt) {
        //   setGanttData(pmoData.gantt);
        // }

        // Reset retry count on successful load
        setRetryCount(0);
      } else {
        // Handle case where response is not successful
        setError({
          hasError: true,
          errorMessage: "La respuesta del servidor no es válida",
          errorType: 'data'
        });
      }
      
    } catch (error: any) {
      console.error('Error loading PMO data:', error);
      
      let errorState: ErrorState = {
        hasError: true,
        errorMessage: "Ocurrió un error desconocido",
        errorType: 'unknown'
      };

      // Categorize error types
      if (error.response) {
        const status = error.response.status;
        if (status === 401 || status === 403) {
          errorState = {
            hasError: true,
            errorMessage: "No tienes permiso para consultar los datos PMO de este proyecto.",
            errorType: 'permission'
          };
        } else if (status === 404) {
          errorState = {
            hasError: true,
            errorMessage: "No se encontraron datos PMO para este proyecto.",
            errorType: 'data'
          };
        } else if (status >= 500) {
          errorState = {
            hasError: true,
            errorMessage: "Error del servidor. Inténtalo nuevamente más tarde.",
            errorType: 'network'
          };
        } else {
          errorState = {
            hasError: true,
            errorMessage: error.response.data?.message || `La solicitud falló con estado ${status}`,
            errorType: 'data'
          };
        }
      } else if (error.request) {
        errorState = {
          hasError: true,
          errorMessage: "Error de conexión. Revisa tu red e inténtalo nuevamente.",
          errorType: 'network'
        };
      } else {
        errorState = {
          hasError: true,
          errorMessage: error.message || "Ocurrió un error inesperado",
          errorType: 'unknown'
        };
      }

      setError(errorState);
      
      // Show appropriate message based on error type
      if (errorState.errorType === 'network') {
        message.error("Error de conexión: no se pudieron cargar los datos PMO");
      } else if (errorState.errorType === 'permission') {
        message.warning("Acceso denegado a los datos PMO");
      } else {
        message.error("No se pudieron cargar los datos PMO");
      }
      
      // Fallback: try to load basic gantt data for milestones only for non-permission errors
      if (errorState.errorType !== 'permission' && retryCount < 2) {
        try {
          const ganttResponse = await apiService.getProjectGantt(projectId);
          if (ganttResponse) {
            // Future implementation for gantt data
            // setGanttData(ganttResponse);
            // Note: getProjectGantt only returns tasks and dependencies
            // Milestones should be loaded separately via getPMOProjectGantt
            if (ganttResponse && ganttResponse.tasks) {
              console.log('Loaded fallback gantt tasks:', ganttResponse.tasks.length);
            }
            message.info("Se cargaron los datos básicos de hitos");
          }
        } catch (ganttError) {
          console.error('Error loading fallback Gantt data:', ganttError);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleViewFullPMO = () => {
    navigate(`/pmo?project=${projectId}`);
  };

  const handleViewGantt = () => {
    navigate(`/pmo/gantt/${projectId}`);
  };

  const getRiskColor = (riskLevel: string) => {
    const colors = {
      low: 'var(--color-success)',
      medium: 'var(--color-warning)', 
      high: 'var(--color-warning)',
      critical: 'var(--color-error)'
    };
    return colors[riskLevel as keyof typeof colors] || 'var(--color-border)';
  };

  const getMilestoneStatusColor = (status: string) => {
    const colors = {
      pending: 'default',
      in_progress: 'processing',
      completed: 'success',
      delayed: 'error',
      cancelled: 'error'
    };
    return colors[status as keyof typeof colors] || 'default';
  };

  const getResponsibilityColor = (responsibility: string) => {
    const colors = {
      internal: 'blue',
      client: 'orange',
      external: 'purple',
      shared: 'cyan'
    };
    return colors[responsibility as keyof typeof colors] || 'default';
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <Spin size="large" />
        <div style={{ marginTop: 16 }}>
          <Text>Cargando indicadores PMO...</Text>
        </div>
      </div>
    );
  }

  // Enhanced error display
  if (error.hasError && !loading) {
    const getErrorIcon = () => {
      switch (error.errorType) {
        case 'network': return <DisconnectOutlined />;
        case 'permission': return <ExclamationCircleOutlined />;
        case 'data': return <DatabaseOutlined />;
        default: return <WarningOutlined />;
      }
    };

    const getErrorActions = () => {
      const actions = [
        <Button 
          key="retry"
          type="primary" 
          icon={<SyncOutlined />}
          onClick={() => {
            setRetryCount(prev => prev + 1);
            loadPMOData();
          }}
          disabled={retryCount >= 3}
        >
          {retryCount >= 3 ? "Límite de intentos alcanzado" : "Reintentar"}
        </Button>
      ];

      if (error.errorType !== 'permission') {
        actions.push(
          <Button 
            key="pmo-dashboard"
            icon={<FundOutlined />}
            onClick={handleViewFullPMO}
          >
            
            Abrir centro PMO
          </Button>
        );
      }

      return actions;
    };

    return (
      <div style={{ padding: '24px' }}>
        <Alert
          message={'No se pudieron cargar los datos PMO'}
          description={error.errorMessage}
          type={error.errorType === 'permission' ? 'warning' : 'error'}
          showIcon
          icon={getErrorIcon()}
          action={<Space>{getErrorActions()}</Space>}
          style={{ marginBottom: '24px' }}
        />
        
        {/* Show partial data if available */}
        {(pmoMetrics || milestones.length > 0) && (
          <Alert
            message="Información parcial disponible"
            description="Se cargó parte de la información PMO, pero algunos datos no están disponibles."
            type="info"
            showIcon
            style={{ marginBottom: '16px' }}
          />
        )}
      </div>
    );
  }

  // No data state (when no error but no data)
  if (!error.hasError && !pmoMetrics && milestones.length === 0 && !loading) {
    return (
      <div style={{ padding: '24px' }}>
        <Empty
          description="Este proyecto todavía no tiene información PMO"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Space>
            <Button 
              type="primary" 
              icon={<FundOutlined />}
              onClick={handleViewFullPMO}
            >
              
              Abrir centro PMO
            </Button>
            <Button 
              icon={<SyncOutlined />}
              onClick={loadPMOData}
            >
              
              Actualizar datos
            </Button>
          </Space>
        </Empty>
      </div>
    );
  }

  const scheduleStatus = pmoMetrics?.schedule_variance_days || 0;
  const showBudget = pmoMetrics?.cost_variance_percentage !== undefined;
  const metricColumnSpan = showBudget ? 6 : 8;
  const costStatus = pmoMetrics?.cost_variance_percentage || 0;
  const qualityScore = pmoMetrics?.bugs_found ? 
    Math.max(0, 100 - ((pmoMetrics.bugs_found - (pmoMetrics.bugs_resolved || 0)) * 10)) : 100;

  return (
    <div style={{ padding: '8px 0' }}>
      <Row gutter={[24, 24]}>
        {/* Left Column - Metrics & Performance */}
        <Col xs={24} lg={14}>
          {/* Performance Metrics */}
          {pmoMetrics && (
            <Card title="Indicadores del proyecto" style={{ marginBottom: '24px' }}>
              <Row gutter={[16, 16]}>
                <Col xs={12} sm={metricColumnSpan}>
                  <Statistic
                    title="Avance del cronograma"
                    value={pmoMetrics.completion_percentage}
                    suffix="%"
                    valueStyle={{ 
                      color: pmoMetrics.completion_percentage > 75 ? 'var(--color-success)' : 
                             pmoMetrics.completion_percentage > 50 ? 'var(--color-warning)' : 'var(--color-error)' 
                    }}
                    prefix={<TrophyOutlined />}
                  />
                </Col>
                <Col xs={12} sm={metricColumnSpan}>
                  <Tooltip title={scheduleStatus >= 0 ? "Días de adelanto" : "Días de retraso"}>
                    <Statistic
                      title="Programar"
                      value={Math.abs(scheduleStatus)}
                      suffix={scheduleStatus >= 0 ? " de adelanto" : " de retraso"}
                      valueStyle={{ 
                        color: scheduleStatus >= 0 ? 'var(--color-success)' : 'var(--color-error)' 
                      }}
                      prefix={scheduleStatus >= 0 ? <RiseOutlined /> : <FallOutlined />}
                    />
                  </Tooltip>
                </Col>
                {showBudget && (
                  <Col xs={12} sm={metricColumnSpan}>
                    <Tooltip title={costStatus <= 0 ? "Bajo el presupuesto" : "Sobre el presupuesto"}>
                      <Statistic
                        title="Presupuesto"
                        value={Math.abs(costStatus)}
                        suffix="%"
                        prefix={costStatus <= 0 ? "+" : "-"}
                        valueStyle={{ 
                          color: costStatus <= 0 ? 'var(--color-success)' : 'var(--color-error)' 
                        }}
                      />
                    </Tooltip>
                  </Col>
                )}
                <Col xs={12} sm={metricColumnSpan}>
                  <Statistic
                    title="Puntaje de calidad"
                    value={qualityScore}
                    suffix="/100"
                    valueStyle={{ 
                      color: qualityScore > 80 ? 'var(--color-success)' : 
                             qualityScore > 60 ? 'var(--color-warning)' : 'var(--color-error)' 
                    }}
                    prefix={<CheckCircleOutlined />}
                  />
                </Col>
              </Row>

              <Divider />

              {/* Risk Assessment */}
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Text strong>Nivel de riesgo</Text>
                    <Tag 
                      color={getRiskColor(pmoMetrics.risk_level)} 
                      style={{ fontSize: '14px', padding: '4px 12px' }}
                    >
                      <WarningOutlined /> {displayLabel(pmoMetrics.risk_level)}
                    </Tag>
                  </Space>
                </Col>
                <Col xs={24} sm={12}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Text strong>Ritmo del equipo</Text>
                    <Statistic
                      value={pmoMetrics.team_velocity}
                      suffix="tareas/semana"
                      valueStyle={{ fontSize: '18px' }}
                      prefix={<ThunderboltOutlined />}
                    />
                  </Space>
                </Col>
              </Row>

              {/* Hours Tracking */}
              {(pmoMetrics.planned_hours > 0 || pmoMetrics.actual_hours > 0) && (
                <>
                  <Divider />
                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Statistic
                        title="Horas planificadas"
                        value={pmoMetrics.planned_hours}
                        suffix="h"
                        prefix={<CalendarOutlined />}
                      />
                    </Col>
                    <Col xs={24} sm={12}>
                      <Statistic
                        title="Horas registradas"
                        value={pmoMetrics.actual_hours}
                        suffix="h"
                        prefix={<ClockCircleOutlined />}
                        valueStyle={{ 
                          color: pmoMetrics.actual_hours > pmoMetrics.planned_hours ? 'var(--color-error)' : 'var(--color-success)' 
                        }}
                      />
                    </Col>
                  </Row>
                  <div style={{ marginTop: '16px' }}>
                    <Text strong>Consumo de horas: </Text>
                    <Progress 
                      percent={pmoMetrics.planned_hours > 0 ? 
                        Math.round((pmoMetrics.actual_hours / pmoMetrics.planned_hours) * 100) : 0}
                      status={pmoMetrics.actual_hours > pmoMetrics.planned_hours ? 'exception' : 'active'}
                    />
                  </div>
                </>
              )}
            </Card>
          )}

          {/* Quality Metrics */}
          {pmoMetrics && (pmoMetrics.bugs_found > 0 || pmoMetrics.bugs_resolved > 0) && (
            <Card title="Indicadores de calidad" style={{ marginBottom: '24px' }}>
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic
                    title="Errores detectados"
                    value={pmoMetrics.bugs_found}
                    valueStyle={{ color: 'var(--color-error)' }}
                    prefix={<ExclamationCircleOutlined />}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="Errores resueltos"
                    value={pmoMetrics.bugs_resolved}
                    valueStyle={{ color: 'var(--color-success)' }}
                    prefix={<CheckCircleOutlined />}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="Tasa de resolución"
                    value={pmoMetrics.bugs_found > 0 ? 
                      Math.round((pmoMetrics.bugs_resolved / pmoMetrics.bugs_found) * 100) : 100}
                    suffix="%"
                    valueStyle={{ color: 'var(--color-info)' }}
                  />
                </Col>
              </Row>
            </Card>
          )}
        </Col>

        {/* Right Column - Milestones & Timeline */}
        <Col xs={24} lg={10}>
          {/* Project Milestones */}
          <Card 
            title="Hitos del proyecto"
            extra={
              <Button 
                type="link" 
                size="small"
                onClick={handleViewGantt}
                icon={<EyeOutlined />}
              >
                
                Ver cronograma completo
              </Button>
            }
            style={{ marginBottom: '24px' }}
          >
            {milestones.length > 0 ? (
              <Timeline
                items={milestones.slice(0, 5).map(milestone => ({
                  dot: milestone.status === 'completed' ? 
                    <CheckCircleOutlined style={{ color: 'var(--color-success)' }} /> :
                    milestone.status === 'delayed' ?
                    <ExclamationCircleOutlined style={{ color: 'var(--color-error)' }} /> :
                    <ClockCircleOutlined style={{ color: 'var(--color-info)' }} />,
                  children: (
                    <div>
                      <div style={{ marginBottom: '4px' }}>
                        <Text strong>{milestone.name}</Text>
                        <div style={{ float: 'right' }}>
                          <Tag color={getMilestoneStatusColor(milestone.status)}>
                            {displayLabel(milestone.status)}
                          </Tag>
                        </div>
                      </div>
                      <div style={{ marginBottom: '4px' }}>
                        <Text type="secondary" style={{ fontSize: '12px' }}>
                          
                          Vence: {dayjs(milestone.planned_date).format('MMM DD, YYYY')}
                          {milestone.actual_date && (
                            <span> | Completado: {dayjs(milestone.actual_date).format('MMM DD, YYYY')}</span>
                          )}
                        </Text>
                      </div>
                      <div style={{ marginBottom: '8px' }}>
                        <Tag color={getResponsibilityColor(milestone.responsibility)}>
                          {displayLabel(milestone.responsibility)}
                        </Tag>
                        {milestone.completion_percentage > 0 && (
                          <Progress 
                            percent={milestone.completion_percentage} 
                            size="small" 
                            style={{ marginTop: '4px' }}
                            showInfo={false}
                          />
                        )}
                      </div>
                      {milestone.delay_justification && (
                        <Alert
                          message={milestone.delay_justification}
                          type="warning"
                          showIcon
                          style={{ fontSize: '11px', marginTop: '4px' }}
                        />
                      )}
                    </div>
                  )
                }))}
              />
            ) : (
              <Empty 
                description="No hay hitos definidos"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ padding: '20px 0' }}
              >
                <Button 
                  type="primary" 
                  size="small"
                  onClick={handleViewFullPMO}
                  icon={<PlusOutlined />}
                >
                  
                  Definir hitos
                </Button>
              </Empty>
            )}
          </Card>

          {/* Quick Insights */}
          <Card title="Observaciones PMO">
            <Space direction="vertical" style={{ width: '100%' }}>
              {pmoMetrics?.risk_level === 'critical' && (
                <Alert
                  message="Riesgo crítico detectado"
                  description="Este proyecto requiere atención inmediata de PMO."
                  type="error"
                  showIcon
                  icon={<FireOutlined />}
                />
              )}
              
              {scheduleStatus < -7 && (
                <Alert
                  message="Retraso del cronograma"
                  description={`El proyecto tiene ${Math.abs(scheduleStatus)} días de retraso.`}
                  type="warning"
                  showIcon
                />
              )}

              {costStatus > 20 && (
                <Alert
                  message="Sobrecosto"
                  description={`El proyecto supera el presupuesto en un ${costStatus}%.`}
                  type="error"
                  showIcon
                />
              )}

              {(!pmoMetrics || (pmoMetrics.completion_percentage < 10 && milestones.length === 0)) && (
                <Alert
                  message="Configuración PMO pendiente"
                  description="Define los hitos e indicadores para mejorar el seguimiento del proyecto."
                  type="info"
                  showIcon
                  action={
                    <Button size="small" onClick={handleViewFullPMO}>
                      
                      Configurar PMO
                    </Button>
                  }
                />
              )}

              {pmoMetrics && pmoMetrics.completion_percentage > 90 && (
                <Alert
                  message="Proyecto próximo a completarse"
                  description="Revisa las actividades de cierre y las lecciones aprendidas."
                  type="success"
                  showIcon
                />
              )}
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
};
