import { displayLabel } from '@/utils/displayLabels';
import React from 'react';
import { Card, Typography, Tag, Space } from 'antd';
import { Idea } from '@/types/idea';
import { PriorityMatrix, QuadrantConfig, QuadrantRules, MatrixAxisConfig, MatrixItemRenderer, MatrixSummary } from '@/components/common';
import { getIdeaStatusColor } from '@/utils';

const { Text } = Typography;

interface IdeaPriorityMatrixProps {
  ideas: Idea[];
}

const IdeaPriorityMatrix: React.FC<IdeaPriorityMatrixProps> = ({ ideas }) => {

  // Quadrant rules for ideas
  const quadrantRules: QuadrantRules<Idea> = {
    getQuadrantInfo: (effort: number, impact: number) => {
      if (impact >= 4 && effort <= 2) {
        return { 
          label: "Resultados rápidos", 
          color: 'var(--color-success)', 
          backgroundColor: 'var(--color-primary-bg)',
          description: "Alto impacto y bajo esfuerzo: priorizar"
        };
      } else if (impact >= 4 && effort >= 4) {
        return { 
          label: "Proyectos estratégicos", 
          color: 'var(--color-warning)', 
          backgroundColor: 'var(--color-warning-bg)',
          description: "Alto impacto y alto esfuerzo: planificar con cuidado"
        };
      } else if (impact <= 2 && effort <= 2) {
        return { 
          label: "Tareas menores", 
          color: 'var(--color-info)', 
          backgroundColor: 'var(--color-info-bg)',
          description: "Bajo impacto y bajo esfuerzo: realizar si hay tiempo"
        };
      } else if (impact <= 2 && effort >= 4) {
        return { 
          label: "Bajo valor", 
          color: 'var(--color-error)', 
          backgroundColor: 'var(--color-error-bg)',
          description: "Bajo impacto y alto esfuerzo: reconsiderar"
        };
      }
      
      return { 
        label: "Evaluar", 
        color: 'var(--color-info)', 
        backgroundColor: 'var(--color-info-bg)',
        description: "Prioridad media: evaluar según los recursos"
      };
    }
  };

  // X-axis configuration (Effort)
  const xAxis: MatrixAxisConfig = {
    label: "Esfuerzo",
    min: 1,
    max: 5,
    getAxisLabel: (value) => `Effort ${value}`,
    getAxisDescription: (value) => {
      const descriptions = { 1: "Muy fácil", 2: "Fácil", 3: "Medio", 4: "Difícil", 5: "Muy difícil" };
      return descriptions[value as keyof typeof descriptions] || '';
    }
  };

  // Y-axis configuration (Impact)
  const yAxis: MatrixAxisConfig = {
    label: "Impacto",
    min: 1,
    max: 5,
    getAxisLabel: (value) => `Impacto ${value}`,
    getAxisDescription: (value) => {
      const descriptions = { 1: "Muy bajo", 2: "Bajo", 3: "Medio", 4: "Alto", 5: "Muy alto" };
      return descriptions[value as keyof typeof descriptions] || '';
    }
  };

  // Item renderer
  const itemRenderer: MatrixItemRenderer<Idea> = {
    getItemKey: (idea) => idea.id,
    renderTooltip: (idea) => (
      <div>
        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
          {idea.title}
        </div>
        <div style={{ marginBottom: '4px' }}>
          
          Puntaje de prioridad: {idea.priority_score.toFixed(2)}
        </div>
        <div style={{ marginBottom: '4px' }}>
          Impacto: {idea.impact_score} | Effort: {idea.effort_score}
        </div>
        <div style={{ marginBottom: '4px' }}>
          Votes: {idea.votes_count}
        </div>
        <div>
          {idea.description.substring(0, 100)}
          {idea.description.length > 100 ? '...' : ''}
        </div>
      </div>
    ),
    renderItem: (idea) => (
      <Card
        size="small"
        style={{
          cursor: 'pointer',
          fontSize: '11px'
        }}
        styles={{ body: { padding: '6px' } }}
      >
        <div style={{ 
          fontWeight: 'bold', 
          marginBottom: '2px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {idea.title}
        </div>
        <Space size="small" style={{ fontSize: '10px' }}>
          <Tag 
            color={getIdeaStatusColor(idea.status)}
            style={{ fontSize: '11px', padding: '1px 4px' }}
          >
            {displayLabel(idea.status)}
          </Tag>
          <Text style={{ fontSize: '10px' }}>
            ↑{idea.votes_count}
          </Text>
        </Space>
      </Card>
    )
  };

  // Summary configuration
  const summary: MatrixSummary<Idea> = {
    getStats: (ideas) => [
      { label: "Total de ideas", value: ideas.length },
      { label: "Resultados rápidos", value: ideas.filter(i => i.impact_score >= 4 && i.effort_score <= 2).length },
      { label: "Proyectos estratégicos", value: ideas.filter(i => i.impact_score >= 4 && i.effort_score >= 4).length },
      { label: "Bajo valor", value: ideas.filter(i => i.impact_score <= 2 && i.effort_score >= 4).length }
    ]
  };

  // Legend configuration
  const legend: QuadrantConfig[] = [
    { label: "Resultados rápidos", color: 'green', backgroundColor: '', description: "Alto impacto, bajo esfuerzo" },
    { label: "Proyectos estratégicos", color: 'orange', backgroundColor: '', description: "Alto impacto, alto esfuerzo" },
    { label: "Tareas menores", color: 'blue', backgroundColor: '', description: "Bajo impacto, bajo esfuerzo" },
    { label: "Bajo valor", color: 'red', backgroundColor: '', description: "Bajo impacto, alto esfuerzo" },
    { label: "Evaluar", color: 'purple', backgroundColor: '', description: "Prioridad media" }
  ];

  return (
    <PriorityMatrix
      items={ideas}
      title="Matriz de prioridad: impacto y esfuerzo"
      description="Las ideas se ubican según su impacto y esfuerzo. Arriba se muestra mayor impacto y a la izquierda, menor esfuerzo."
      xAxis={xAxis}
      yAxis={yAxis}
      quadrantRules={quadrantRules}
      itemRenderer={itemRenderer}
      summary={summary}
      getXValue={(idea) => idea.effort_score}
      getYValue={(idea) => idea.impact_score}
      legend={legend}
    />
  );
};

export default IdeaPriorityMatrix;
