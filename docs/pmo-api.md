# PMO API Documentation

## Overview

The PMO (Project Management Office) API provides comprehensive project analytics, milestone management, and performance tracking capabilities. This API enables project managers to monitor project health, track progress, and generate detailed analytics reports.

## Base URL

All PMO endpoints are prefixed with:
```
http://localhost:5001/api/pmo
```

## Authentication

All endpoints require authentication via Bearer token in the Authorization header:
```
Authorization: Bearer <your-token>
```

### Budget and cost visibility

Only `team_lead` receives budgets and costs. For any other role (or a missing role) `GET /dashboard`, `GET /analytics`, `GET /projects/:id/gantt`, `GET /projects/:id/metrics` and `POST /projects/:id/metrics` omit these keys: `budget`, `planned_budget`, `actual_cost`, `cost_variance_percentage`, `budget_utilization_percentage`, `budget_performance`, `total_planned_budget`, `total_actual_cost`, `overall_budget_variance`, `over_budget_projects`, `budget_planned`, `budget_spent`, `budgetAnalysis`, `on_budget_projects`, `total_budget_managed`, `avg_budget_variance`, `on_budget_deliveries`, `on_budget_rate`, and the `budget_overrun` entry of `risks`. Hours (`planned_hours`, `actual_hours`, `budgeted_hours`) and milestone `financial_impact` are not hidden. Which roles can open each route does not change.

## Table of Contents

1. [Dashboard Endpoints](#dashboard-endpoints)
2. [Analytics Endpoints](#analytics-endpoints)
3. [Project Gantt & Timeline](#project-gantt--timeline)
4. [Milestone Management](#milestone-management)
5. [Project Metrics](#project-metrics)
6. [Response Schemas](#response-schemas)
7. [Error Handling](#error-handling)

---

## Dashboard Endpoints

### GET /dashboard

Retrieves main PMO dashboard data with project overview and key metrics.

**Request:**
```http
GET /api/pmo/dashboard
Authorization: Bearer <token>
```

**Response:**
```json
{
  "projects": [
    {
      "id": 1,
      "name": "Project Alpha",
      "status": "active",
      "priority": "high",
      "completion_percentage": 75,
      "schedule_variance_days": -2,
      "cost_variance_percentage": 15,
      "risk_level": "medium",
      "planned_hours": 100,
      "actual_hours": 85,
      "planned_budget": 50000,
      "actual_cost": 45000,
      "team_velocity": 8.5,
      "bugs_found": 3,
      "bugs_resolved": 2,
      "client_satisfaction_score": 4.2,
      "assigned_to_name": "John Doe",
      "project_health_status": "healthy",
      "days_to_deadline": 15,
      "total_milestones": 5,
      "completed_milestones": 3
    }
  ],
  "overallMetrics": {
    "total_projects": 25,
    "active_projects": 18,
    "critical_projects": 2,
    "delayed_projects": 3,
    "avg_completion": 68.5,
    "total_planned_budget": 1250000,
    "total_actual_cost": 1100000,
    "avg_satisfaction": 4.1
  },
  "upcomingMilestones": [
    {
      "id": 1,
      "name": "Development Complete",
      "project_name": "Project Alpha",
      "project_priority": "high",
      "planned_date": "2024-09-15",
      "responsible_name": "Jane Smith",
      "days_until": 7,
      "status": "in_progress"
    }
  ],
  "teamWorkload": [
    {
      "id": 1,
      "full_name": "John Doe",
      "role": "rpa_developer",
      "assigned_projects": 3,
      "remaining_hours": 120,
      "avg_project_completion": 72.5
    }
  ]
}
```

---

## Analytics Endpoints

### GET /analytics

Retrieves comprehensive PMO analytics with detailed performance metrics and trends.

**Request:**
```http
GET /api/pmo/analytics
Authorization: Bearer <token>
```

**Response:**
```json
{
  "executiveSummary": {
    "total_projects": 25,
    "active_projects": 18,
    "completed_projects": 7,
    "critical_projects": 2,
    "over_budget_projects": 3,
    "delayed_projects": 4,
    "avg_completion": 68.5,
    "avg_satisfaction": 4.1,
    "total_planned_budget": 1250000.00,
    "total_actual_cost": 1100000.00,
    "overall_budget_variance": -12.0
  },
  "trendAnalysis": [
    {
      "week": "2024-35",
      "projects_updated": 12,
      "avg_completion": 71.2,
      "avg_satisfaction": 4.0,
      "critical_count": 2,
      "budget_planned": 150000,
      "budget_spent": 132000
    }
  ],
  "budgetAnalysis": [
    {
      "project_name": "Project Alpha",
      "project_id": 1,
      "planned_budget": 50000.00,
      "actual_cost": 45000.00,
      "cost_variance_percentage": -10.0,
      "completion_percentage": 75,
      "projected_total_cost": 60000.00,
      "budget_status": "on_track",
      "project_manager": "John Doe"
    }
  ],
  "scheduleAnalysis": [
    {
      "project_name": "Project Alpha",
      "project_id": 1,
      "planned_start": "2024-07-01",
      "planned_end": "2024-09-30",
      "actual_start_date": "2024-07-03",
      "actual_end_date": null,
      "schedule_variance_days": -2,
      "completion_percentage": 75,
      "days_to_deadline": 15,
      "schedule_status": "delayed",
      "project_manager": "John Doe"
    }
  ],
  "riskAnalysis": [
    {
      "project_name": "Project Alpha",
      "project_id": 1,
      "risk_level": "medium",
      "completion_percentage": 75,
      "cost_variance_percentage": -10.0,
      "schedule_variance_days": -2,
      "bugs_found": 3,
      "bugs_resolved": 2,
      "bug_resolution_rate": 66.7,
      "client_satisfaction_score": 4.2,
      "project_manager": "John Doe",
      "priority_level": "manageable"
    }
  ],
  "teamAnalysis": [
    {
      "full_name": "John Doe",
      "role": "rpa_developer",
      "total_projects": 5,
      "active_projects": 3,
      "completed_projects": 2,
      "avg_completion": 72.0,
      "avg_velocity": 8.5,
      "avg_satisfaction": 4.1,
      "total_bugs_found": 8,
      "total_bugs_resolved": 7,
      "bug_resolution_rate": 87.5,
      "on_time_projects": 4,
      "on_budget_projects": 4,
      "total_budget_managed": 150000.00,
      "avg_budget_variance": -5.2
    }
  ],
  "qualityMetrics": [
    {
      "project_name": "Project Alpha",
      "project_id": 1,
      "bugs_found": 3,
      "bugs_resolved": 2,
      "resolution_rate": 66.7,
      "client_satisfaction_score": 4.2,
      "completion_percentage": 75,
      "quality_status": "good",
      "project_manager": "John Doe"
    }
  ],
  "resourceUtilization": [
    {
      "full_name": "John Doe",
      "role": "rpa_developer",
      "assigned_projects": 3,
      "total_planned_hours": 300,
      "total_actual_hours": 285,
      "avg_velocity": 8.5,
      "utilization_percentage": 95.0,
      "utilization_status": "optimal"
    }
  ],
  "satisfactionTrends": [
    {
      "client_name": "Project Alpha",
      "total_projects": 1,
      "avg_satisfaction": 4.2,
      "completed_projects": 0,
      "on_time_deliveries": 1,
      "on_budget_deliveries": 1,
      "on_time_rate": 100.0,
      "on_budget_rate": 100.0
    }
  ],
  "riskDistribution": [
    {
      "risk_level": "critical",
      "project_count": 2,
      "percentage": 11.11,
      "avg_budget_variance": 25.5,
      "avg_schedule_variance": -8.5,
      "avg_satisfaction": 3.2
    },
    {
      "risk_level": "high",
      "project_count": 4,
      "percentage": 22.22,
      "avg_budget_variance": 15.2,
      "avg_schedule_variance": -4.2,
      "avg_satisfaction": 3.8
    }
  ]
}
```

---

## Project Gantt & Timeline

### GET /projects/:id/gantt

Retrieves Gantt chart data for a specific project including tasks, milestones, and dependencies.

**Request:**
```http
GET /api/pmo/projects/1/gantt
Authorization: Bearer <token>
```

**Parameters:**
- `id` (path parameter): Project ID

**Response:**
```json
{
  "project": {
    "id": 1,
    "name": "Project Alpha",
    "description": "Advanced RPA implementation",
    "status": "active",
    "start_date": "2024-07-01",
    "end_date": "2024-09-30",
    "completion_percentage": 75,
    "schedule_variance_days": -2,
    "cost_variance_percentage": -10.0,
    "risk_level": "medium"
  },
  "tasks": [
    {
      "id": 1,
      "title": "Requirements Analysis",
      "description": "Analyze project requirements",
      "status": "done",
      "priority": "high",
      "start_date": "2024-07-01",
      "due_date": "2024-07-15",
      "column_name": "Done",
      "assignee_name": "John Doe",
      "actual_hours": 25,
      "planned_hours": 30,
      "position": 1
    }
  ],
  "milestones": [
    {
      "id": 1,
      "name": "Phase 1 Complete",
      "description": "First phase milestone",
      "milestone_type": "delivery",
      "planned_date": "2024-08-15",
      "actual_date": "2024-08-17",
      "status": "completed",
      "priority": "high",
      "responsible_name": "Jane Smith"
    }
  ],
  "projectDependencies": [
    {
      "id": 1,
      "source_project_id": 2,
      "dependent_project_id": 1,
      "dependency_type": "finish_to_start",
      "source_project_name": "Infrastructure Setup",
      "dependent_project_name": "Project Alpha"
    }
  ],
  "taskDependencies": [
    {
      "id": 1,
      "predecessor_id": 1,
      "successor_id": 2,
      "dependency_type": "finish_to_start",
      "predecessor_title": "Requirements Analysis",
      "successor_title": "Design Phase"
    }
  ]
}
```

### GET /projects/:id/metrics

Retrieves detailed PMO metrics for a specific project.

**Request:**
```http
GET /api/pmo/projects/1/metrics
Authorization: Bearer <token>
```

**Response:**
```json
{
  "project": {
    "id": 1,
    "name": "Project Alpha",
    "status": "active",
    "completion_percentage": 75,
    "schedule_variance_days": -2,
    "cost_variance_percentage": -10.0,
    "risk_level": "medium",
    "planned_hours": 100,
    "actual_hours": 85,
    "planned_budget": 50000,
    "actual_cost": 45000,
    "team_velocity": 8.5,
    "bugs_found": 3,
    "bugs_resolved": 2,
    "client_satisfaction_score": 4.2,
    "project_health_status": "healthy",
    "days_to_deadline": 15,
    "hours_completion_ratio": 85.0,
    "budget_utilization_percentage": 90.0,
    "assigned_to_name": "John Doe"
  },
  "milestones": {
    "total": 5,
    "completed": 3,
    "upcoming": 1,
    "list": [
      {
        "id": 1,
        "title": "Phase 1 Complete",
        "description": "First phase milestone",
        "due_date": "2024-08-15",
        "status": "completed",
        "completion_date": "2024-08-17",
        "created_at": "2024-07-01T10:00:00Z"
      }
    ]
  },
  "risks": [
    {
      "risk_type": "schedule_delay",
      "risk_title": "Schedule Delay",
      "risk_description": "Project is 2 days behind schedule",
      "severity": "medium",
      "detected_date": "2024-08-20T15:30:00Z"
    }
  ],
  "team": {
    "team_size": 3,
    "avg_daily_hours": 6.5,
    "total_hours_logged": 195,
    "active_days": 30
  },
  "kpis": {
    "schedule_performance": "minor_delay",
    "budget_performance": "within_budget",
    "quality_score": 70,
    "team_productivity": 8.5,
    "client_satisfaction": 4.2
  },
  "alerts": [
    {
      "risk_type": "quality_issues",
      "risk_title": "Quality Concerns",
      "risk_description": "High bug ratio: 3 found, 2 resolved",
      "severity": "medium",
      "detected_date": "2024-08-20T15:30:00Z"
    }
  ]
}
```

---

## Milestone Management

### POST /milestones

Creates a new project milestone.

**Request:**
```http
POST /api/pmo/milestones
Authorization: Bearer <token>
Content-Type: application/json

{
  "project_id": 1,
  "name": "Testing Phase Complete",
  "description": "All testing activities completed",
  "milestone_type": "delivery",
  "planned_date": "2024-09-15",
  "priority": "high",
  "responsible_user_id": 2,
  "impact_on_timeline": 5,
  "responsibility": "internal",
  "estimated_delay_days": 0,
  "financial_impact": 5000
}
```

**Response:**
```json
{
  "id": 5,
  "project_id": 1,
  "name": "Testing Phase Complete",
  "description": "All testing activities completed",
  "milestone_type": "delivery",
  "planned_date": "2024-09-15",
  "actual_date": null,
  "status": "pending",
  "priority": "high",
  "responsible_user_id": 2,
  "responsible_name": "Jane Smith",
  "project_name": "Project Alpha",
  "impact_on_timeline": 5,
  "responsibility": "internal",
  "estimated_delay_days": 0,
  "financial_impact": 5000,
  "created_by": 1,
  "created_at": "2024-08-24T10:00:00Z",
  "updated_at": "2024-08-24T10:00:00Z"
}
```

### PUT /milestones/:id

Updates an existing milestone.

**Request:**
```http
PUT /api/pmo/milestones/5
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "completed",
  "actual_date": "2024-09-14",
  "completion_percentage": 100
}
```

**Notes:**
- Only these columns are accepted: `name`, `description`, `milestone_type`, `planned_date`, `end_date`, `actual_date`, `status`, `priority`, `responsible_user_id`, `completion_percentage`, `impact_on_timeline`, `responsibility`, `blocking_reason`, `delay_justification`, `external_contact`, `estimated_delay_days`, `financial_impact`. Values must be text, number, boolean or null.
- Any other key, a nested object or array as a value, or a body without any valid field returns `400` with a Spanish `error` message and nothing is written. `id`, `created_by` and `created_at` are silently ignored so a client can send the whole milestone back.
- The response lists explicit columns (`id`, `project_id`, the accepted columns, `responsible_name`, `project_name`); server-owned fields such as `created_by`, `created_at`, `updated_at` and `baseline_planned_date` are not returned.

### DELETE /milestones/:id

Deletes a milestone.

**Request:**
```http
DELETE /api/pmo/milestones/5
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Milestone deleted successfully"
}
```

---

## Project Metrics

### POST /projects/:id/metrics

Updates PMO metrics for a specific project.

**Request:**
```http
POST /api/pmo/projects/1/metrics
Authorization: Bearer <token>
Content-Type: application/json

{
  "completion_percentage": 80,
  "schedule_variance_days": -1,
  "cost_variance_percentage": -5,
  "risk_level": "low",
  "planned_hours": 120,
  "actual_hours": 100,
  "planned_budget": 55000,
  "actual_cost": 48000,
  "team_velocity": 9.0,
  "bugs_found": 2,
  "bugs_resolved": 2,
  "client_satisfaction_score": 4.5
}
```

**Response:**
```json
{
  "id": 1,
  "project_id": 1,
  "completion_percentage": 80,
  "schedule_variance_days": -1,
  "cost_variance_percentage": -5,
  "risk_level": "low",
  "planned_hours": 120,
  "actual_hours": 100,
  "planned_budget": 55000,
  "actual_cost": 48000,
  "team_velocity": 9.0,
  "bugs_found": 2,
  "bugs_resolved": 2,
  "client_satisfaction_score": 4.5,
  "last_updated": "2024-08-24T15:30:00Z",
  "updated_by": 1
}
```

**Notes:**
- Only these columns are accepted: `planned_hours`, `planned_start_date`, `planned_end_date`, `planned_budget`, `actual_hours`, `actual_start_date`, `actual_end_date`, `actual_cost`, `completion_percentage`, `completed_tasks`, `total_tasks`, `schedule_variance_days`, `cost_variance_percentage`, `scope_variance_percentage`, `risk_level`, `risk_factors`, `bugs_found`, `bugs_resolved`, `client_satisfaction_score`, `team_velocity`.
- Any other key (including `id`, `project_id`, `last_updated`, `updated_by`), a nested object or array as a value, a body that is not a JSON object, or a body without any field returns `400` with a Spanish `error` message (for example `{ "error": "Campos no permitidos: ..." }`) and nothing is written.
- `rpa_operations` can write `planned_budget`, `actual_cost` and `cost_variance_percentage`, but the response omits them (see Budget and cost visibility).

---

## Response Schemas

### Project Schema
```json
{
  "id": "integer",
  "name": "string",
  "description": "string",
  "status": "string (active|completed|on_hold|cancelled)",
  "priority": "string (critical|high|medium|low)",
  "start_date": "string (ISO date)",
  "end_date": "string (ISO date)",
  "budget": "number",
  "assigned_to": "integer (user_id)",
  "assigned_to_name": "string",
  "completion_percentage": "number (0-100)",
  "schedule_variance_days": "number (negative = delayed)",
  "cost_variance_percentage": "number",
  "risk_level": "string (critical|high|medium|low)",
  "team_velocity": "number",
  "client_satisfaction_score": "number (1-5)"
}
```

### Milestone Schema
```json
{
  "id": "integer",
  "project_id": "integer",
  "name": "string",
  "description": "string",
  "milestone_type": "string (delivery|review|approval|checkpoint)",
  "planned_date": "string (ISO date)",
  "actual_date": "string (ISO date) | null",
  "status": "string (pending|in_progress|completed|delayed|cancelled)",
  "priority": "string (critical|high|medium|low)",
  "responsible_user_id": "integer",
  "responsibility": "string (internal|client|external|shared)",
  "impact_on_timeline": "number (days)",
  "completion_percentage": "number (0-100)",
  "blocking_reason": "string | null",
  "delay_justification": "string | null",
  "external_contact": "string | null",
  "estimated_delay_days": "number",
  "financial_impact": "number"
}
```

---

## Error Handling

The API uses standard HTTP status codes:

- **200 OK**: Request successful
- **201 Created**: Resource created successfully
- **400 Bad Request**: Invalid request data
- **401 Unauthorized**: Authentication required
- **403 Forbidden**: Access denied
- **404 Not Found**: Resource not found
- **500 Internal Server Error**: Server error

### Error Response Format
```json
{
  "error": "Error message description"
}
```

### Common Error Scenarios

1. **Missing required fields (400)**:
   ```json
   {
     "error": "Missing required fields: project_id, name, planned_date"
   }
   ```

2. **Project not found (404)**:
   ```json
   {
     "error": "Project not found"
   }
   ```

3. **Access denied (403)**:
   ```json
   {
     "error": "Access denied. You may not have permission to view this project's PMO data."
   }
   ```

---

## Rate Limits

- Standard endpoints: 100 requests per minute per user
- Analytics endpoints: 20 requests per minute per user
- Bulk operations: 10 requests per minute per user

## Best Practices

1. **Caching**: Analytics data is cached for 5 minutes to improve performance
2. **Pagination**: Use limit/offset parameters for large datasets
3. **Error Handling**: Always check response status and handle errors gracefully
4. **Authentication**: Keep tokens secure and refresh before expiration
5. **Data Validation**: Validate dates, numbers, and enum values before sending

## SDK and Libraries

The frontend uses the `apiService` class which provides TypeScript-friendly methods:

```typescript
// Get PMO dashboard
const dashboard = await apiService.getPMODashboard();

// Get project metrics
const metrics = await apiService.getProjectPMOMetrics(projectId);

// Create milestone
const milestone = await apiService.createMilestone(milestoneData);
```

## Support and Contact

For API support or questions, contact the development team or check the project's GitHub issues.