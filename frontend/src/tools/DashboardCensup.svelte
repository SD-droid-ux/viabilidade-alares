<script>
  import { onMount, onDestroy } from 'svelte';
  import Loading from '../Loading.svelte';
  import { getApiUrl } from '../config.js';

  // Props do componente
  export let currentUser = '';
  export let userTipo = 'user';
  export let onBackToDashboard = () => {};
  export let onSettingsRequest = null;
  export let onSettingsHover = null;

  // Estados da ferramenta
  let isLoading = false;
  let loadingMessage = '';
  let showSettingsModal = false;
  
  // Estados do dashboard
  let activeReport = 'stats'; // 'stats' ou 'timeline'
  let selectedPeriod = 'DIA'; // DIA, SEMANA, MÊS, TRIMESTRE, SEMESTRE, ANUAL
  
  // Dados das APIs
  let statsData = {
    stats: [],
    total: 0
  };
  let timelineData = {
    timeline: [],
    total: 0,
    period: 'DIA'
  };
  
  // Estados de loading específicos
  let loadingStats = false;
  let loadingTimeline = false;
  let error = null;
  
  // Intervalo para atualização automática
  let refreshInterval = null;
  const REFRESH_INTERVAL_MS = 60000; // 1 minuto

  // Função para abrir configurações
  function openSettings() {
    showSettingsModal = true;
  }

  // Função para pré-carregar configurações no hover
  function preloadSettingsData() {
    // Pré-carregar dados se necessário
  }

  // Função para carregar estatísticas
  async function loadStats() {
    loadingStats = true;
    error = null;
    
    try {
      const response = await fetch(getApiUrl('/api/vi-ala/stats'));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      if (data.success) {
        statsData = data;
      } else {
        throw new Error(data.error || 'Erro ao carregar estatísticas');
      }
    } catch (err) {
      console.error('Erro ao carregar estatísticas:', err);
      error = err.message;
    } finally {
      loadingStats = false;
    }
  }

  // Função para carregar timeline
  async function loadTimeline() {
    loadingTimeline = true;
    error = null;
    
    try {
      const response = await fetch(getApiUrl(`/api/vi-ala/timeline?period=${selectedPeriod}`));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      if (data.success) {
        timelineData = data;
      } else {
        throw new Error(data.error || 'Erro ao carregar timeline');
      }
    } catch (err) {
      console.error('Erro ao carregar timeline:', err);
      error = err.message;
    } finally {
      loadingTimeline = false;
    }
  }

  // Função para atualizar dados do relatório ativo
  async function refreshActiveReport() {
    if (activeReport === 'stats') {
      await loadStats();
    } else {
      await loadTimeline();
    }
  }

  // Função para mudar período
  async function changePeriod(period) {
    selectedPeriod = period;
    if (activeReport === 'timeline') {
      await loadTimeline();
    }
  }

  // Função para mudar relatório ativo
  async function changeReport(report) {
    activeReport = report;
    await refreshActiveReport();
  }

  // Inicializar ferramenta quando o componente é montado
  onMount(async () => {
    try {
      // Registrar função de configurações com o parent
      if (onSettingsRequest && typeof onSettingsRequest === 'function') {
        onSettingsRequest(openSettings);
      }
      
      // Registrar função de pré-carregamento no hover
      if (onSettingsHover && typeof onSettingsHover === 'function') {
        onSettingsHover(preloadSettingsData);
      }
      
      // Carregar dados iniciais
      await loadStats();
      await loadTimeline();
      
      // Configurar atualização automática
      refreshInterval = setInterval(() => {
        refreshActiveReport();
      }, REFRESH_INTERVAL_MS);
      
    } catch (err) {
      console.error('Erro ao inicializar ferramenta:', err);
      isLoading = false;
    }
  });

  // Cleanup ao desmontar
  onDestroy(() => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });

  // Cores para o gráfico de pizza
  const pieColors = [
    '#6366F1', '#8B5CF6', '#EC4899', '#F43F5E', '#EF4444',
    '#F59E0B', '#10B981', '#06B6D4', '#3B82F6', '#6366F1'
  ];
</script>

<!-- Conteúdo da Ferramenta Dashboard CENSUP -->
<div class="dashboard-censup-content">
  {#if isLoading}
    <Loading message={loadingMessage} />
  {:else}
    <div class="dashboard-layout">
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-header">
          <h2>📊 Dashboard CENSUP</h2>
        </div>
        
        <nav class="sidebar-nav">
          <button 
            class="nav-item"
            class:active={activeReport === 'stats'}
            on:click={() => changeReport('stats')}
          >
            <span class="nav-icon">🥧</span>
            <span class="nav-label">Estatísticas por Tabulação</span>
          </button>
          
          <button 
            class="nav-item"
            class:active={activeReport === 'timeline'}
            on:click={() => changeReport('timeline')}
          >
            <span class="nav-icon">📈</span>
            <span class="nav-label">Evolução Temporal</span>
          </button>
        </nav>
        
        {#if activeReport === 'timeline'}
          <div class="period-selector">
            <h3>Período</h3>
            <div class="period-buttons">
              <button 
                class="period-btn"
                class:active={selectedPeriod === 'DIA'}
                on:click={() => changePeriod('DIA')}
              >Dia</button>
              <button 
                class="period-btn"
                class:active={selectedPeriod === 'SEMANA'}
                on:click={() => changePeriod('SEMANA')}
              >Semana</button>
              <button 
                class="period-btn"
                class:active={selectedPeriod === 'MÊS'}
                on:click={() => changePeriod('MÊS')}
              >Mês</button>
              <button 
                class="period-btn"
                class:active={selectedPeriod === 'TRIMESTRE'}
                on:click={() => changePeriod('TRIMESTRE')}
              >Trimestre</button>
              <button 
                class="period-btn"
                class:active={selectedPeriod === 'SEMESTRE'}
                on:click={() => changePeriod('SEMESTRE')}
              >Semestre</button>
              <button 
                class="period-btn"
                class:active={selectedPeriod === 'ANUAL'}
                on:click={() => changePeriod('ANUAL')}
              >Anual</button>
            </div>
          </div>
        {/if}
        
        <div class="sidebar-footer">
          <button class="refresh-btn" on:click={refreshActiveReport}>
            🔄 Atualizar
          </button>
        </div>
      </aside>

      <!-- Área de Conteúdo -->
      <main class="main-content">
        {#if error}
          <div class="error-message">
            <p>❌ Erro: {error}</p>
            <button on:click={refreshActiveReport}>Tentar novamente</button>
          </div>
        {/if}

        {#if activeReport === 'stats'}
          <!-- Relatório de Estatísticas -->
          <div class="report-section">
            <div class="report-header">
              <h1>Estatísticas por Tabulação</h1>
              <p class="subtitle">Distribuição dos relatórios gerados por tabulação final</p>
            </div>

            {#if loadingStats}
              <div class="loading-container">
                <Loading message="Carregando estatísticas..." />
              </div>
            {:else if statsData.stats.length === 0}
              <div class="empty-state">
                <p>📭 Nenhum dado disponível ainda.</p>
                <p>Gere alguns relatórios na ferramenta Viabilidade Alares para ver as estatísticas.</p>
              </div>
            {:else}
              <div class="stats-container">
                <!-- Gráfico de Pizza -->
                <div class="chart-container">
                  <h2>Distribuição por Tabulação</h2>
                  <div class="pie-chart-wrapper">
                    <svg class="pie-chart" viewBox="0 0 400 400">
                      {@const total = statsData.total}
                      {@const centerX = 200}
                      {@const centerY = 200}
                      {@const radius = 150}
                      {@let currentAngle = -90}
                      
                      {#each statsData.stats as stat, index}
                        {@const sliceAngle = (stat.value / total) * 360}
                        {@const startAngle = currentAngle}
                        {@const endAngle = currentAngle + sliceAngle}
                        
                        {@const startAngleRad = (startAngle * Math.PI) / 180}
                        {@const endAngleRad = (endAngle * Math.PI) / 180}
                        
                        {@const x1 = centerX + radius * Math.cos(startAngleRad)}
                        {@const y1 = centerY + radius * Math.sin(startAngleRad)}
                        {@const x2 = centerX + radius * Math.cos(endAngleRad)}
                        {@const y2 = centerY + radius * Math.sin(endAngleRad)}
                        
                        {@const largeArcFlag = sliceAngle > 180 ? 1 : 0}
                        
                        <path
                          d="M {centerX} {centerY} L {x1} {y1} A {radius} {radius} 0 {largeArcFlag} 1 {x2} {y2} Z"
                          fill={pieColors[index % pieColors.length]}
                          stroke="#fff"
                          stroke-width="2"
                          class="pie-slice"
                        />
                        
                        {@const labelAngle = (startAngle + endAngle) / 2}
                        {@const labelAngleRad = (labelAngle * Math.PI) / 180}
                        {@const labelRadius = radius * 0.7}
                        {@const labelX = centerX + labelRadius * Math.cos(labelAngleRad)}
                        {@const labelY = centerY + labelRadius * Math.sin(labelAngleRad)}
                        
                        <text
                          x={labelX}
                          y={labelY}
                          text-anchor="middle"
                          dominant-baseline="middle"
                          fill="#fff"
                          font-size="14"
                          font-weight="bold"
                        >
                          {stat.percentage}%
                        </text>
                        
                        {@const currentAngle = endAngle}
                      {/each}
                    </svg>
                  </div>
                  
                  <!-- Legenda -->
                  <div class="legend">
                    {#each statsData.stats as stat, index}
                      <div class="legend-item">
                        <div 
                          class="legend-color" 
                          style="background-color: {pieColors[index % pieColors.length]}"
                        ></div>
                        <span class="legend-label">{stat.label}</span>
                        <span class="legend-value">{stat.value} ({stat.percentage}%)</span>
                      </div>
                    {/each}
                  </div>
                </div>

                <!-- Resumo -->
                <div class="summary-card">
                  <h3>Resumo</h3>
                  <div class="summary-item">
                    <span class="summary-label">Total de Relatórios:</span>
                    <span class="summary-value">{statsData.total}</span>
                  </div>
                  <div class="summary-item">
                    <span class="summary-label">Tabulações Diferentes:</span>
                    <span class="summary-value">{statsData.stats.length}</span>
                  </div>
                </div>
              </div>
            {/if}
          </div>
        {:else if activeReport === 'timeline'}
          <!-- Relatório de Timeline -->
          <div class="report-section">
            <div class="report-header">
              <h1>Evolução Temporal</h1>
              <p class="subtitle">Quantidade de VI ALAs gerados ao longo do tempo</p>
            </div>

            {#if loadingTimeline}
              <div class="loading-container">
                <Loading message="Carregando timeline..." />
              </div>
            {:else if timelineData.timeline.length === 0}
              <div class="empty-state">
                <p>📭 Nenhum dado disponível ainda.</p>
                <p>Gere alguns relatórios na ferramenta Viabilidade Alares para ver a evolução.</p>
              </div>
            {:else}
              <div class="timeline-container">
                <!-- Gráfico de Linha -->
                <div class="chart-container">
                  <h2>Evolução por {selectedPeriod}</h2>
                  <div class="line-chart-wrapper">
                    <svg class="line-chart" viewBox="0 0 800 400">
                      {@const padding = 60}
                      {@const chartWidth = 800 - padding * 2}
                      {@const chartHeight = 400 - padding * 2}
                      {@const maxValue = Math.max(...timelineData.timeline.map(d => d.count), 1)}
                      {@const data = timelineData.timeline}
                      
                      <!-- Grid -->
                      <g class="grid">
                        {#each Array(6) as _, i}
                          {@const y = padding + (chartHeight / 5) * i}
                          <line x1={padding} y1={y} x2={800 - padding} y2={y} stroke="#e5e7eb" stroke-width="1" />
                          <text x={padding - 10} y={y} text-anchor="end" dominant-baseline="middle" fill="#6b7280" font-size="12">
                            {Math.round(maxValue - (maxValue / 5) * i)}
                          </text>
                        {/each}
                      </g>
                      
                      <!-- Linha do gráfico -->
                      <polyline
                        points={data.map((d, i) => {
                          const x = padding + (chartWidth / (data.length - 1 || 1)) * i;
                          const y = padding + chartHeight - (d.count / maxValue) * chartHeight;
                          return `${x},${y}`;
                        }).join(' ')}
                        fill="none"
                        stroke="#6366F1"
                        stroke-width="3"
                        class="line-path"
                      />
                      
                      <!-- Pontos -->
                      {#each data as point, i}
                        {@const x = padding + (chartWidth / (data.length - 1 || 1)) * i}
                        {@const y = padding + chartHeight - (point.count / maxValue) * chartHeight}
                        <circle
                          cx={x}
                          cy={y}
                          r="5"
                          fill="#6366F1"
                          stroke="#fff"
                          stroke-width="2"
                          class="data-point"
                        />
                        <text
                          x={x}
                          y={y - 15}
                          text-anchor="middle"
                          fill="#374151"
                          font-size="12"
                          font-weight="bold"
                        >
                          {point.count}
                        </text>
                      {/each}
                      
                      <!-- Eixo X (períodos) -->
                      <g class="x-axis">
                        {#each data as point, i}
                          {@const x = padding + (chartWidth / (data.length - 1 || 1)) * i}
                          <text
                            x={x}
                            y={400 - padding + 20}
                            text-anchor="middle"
                            fill="#6b7280"
                            font-size="11"
                            transform="rotate(-45 {x} {400 - padding + 20})"
                          >
                            {point.period}
                          </text>
                        {/each}
                      </g>
                    </svg>
                  </div>
                </div>

                <!-- Tabela de Dados -->
                <div class="data-table-container">
                  <h3>Dados Detalhados</h3>
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Período</th>
                        <th>Quantidade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each timelineData.timeline as point}
                        <tr>
                          <td>{point.period}</td>
                          <td class="count-cell">{point.count}</td>
                        </tr>
                      {/each}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td><strong>Total</strong></td>
                        <td><strong>{timelineData.total}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </main>
    </div>
  {/if}
</div>

<style>
  .dashboard-censup-content {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #f5f7fa;
  }

  .dashboard-layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* Sidebar */
  .sidebar {
    width: 280px;
    background: #fff;
    border-right: 1px solid #e5e7eb;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .sidebar-header {
    padding: 1.5rem;
    border-bottom: 1px solid #e5e7eb;
  }

  .sidebar-header h2 {
    margin: 0;
    font-size: 1.25rem;
    color: #1f2937;
    font-weight: 600;
  }

  .sidebar-nav {
    padding: 1rem;
    flex: 1;
  }

  .nav-item {
    width: 100%;
    padding: 0.75rem 1rem;
    margin-bottom: 0.5rem;
    background: transparent;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    transition: all 0.2s;
    text-align: left;
    color: #6b7280;
  }

  .nav-item:hover {
    background: #f3f4f6;
    color: #1f2937;
  }

  .nav-item.active {
    background: #6366F1;
    color: #fff;
  }

  .nav-icon {
    font-size: 1.25rem;
  }

  .nav-label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .period-selector {
    padding: 1rem;
    border-top: 1px solid #e5e7eb;
    border-bottom: 1px solid #e5e7eb;
  }

  .period-selector h3 {
    margin: 0 0 0.75rem 0;
    font-size: 0.875rem;
    color: #6b7280;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .period-buttons {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }

  .period-btn {
    padding: 0.5rem;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 500;
    color: #6b7280;
    transition: all 0.2s;
  }

  .period-btn:hover {
    background: #e5e7eb;
    color: #1f2937;
  }

  .period-btn.active {
    background: #6366F1;
    color: #fff;
    border-color: #6366F1;
  }

  .sidebar-footer {
    padding: 1rem;
    border-top: 1px solid #e5e7eb;
  }

  .refresh-btn {
    width: 100%;
    padding: 0.75rem;
    background: #6366F1;
    color: #fff;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    transition: background 0.2s;
  }

  .refresh-btn:hover {
    background: #4f46e5;
  }

  /* Main Content */
  .main-content {
    flex: 1;
    overflow-y: auto;
    padding: 2rem;
  }

  .error-message {
    background: #fee2e2;
    border: 1px solid #fecaca;
    color: #991b1b;
    padding: 1rem;
    border-radius: 8px;
    margin-bottom: 1rem;
  }

  .error-message button {
    margin-top: 0.5rem;
    padding: 0.5rem 1rem;
    background: #dc2626;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .report-section {
    max-width: 1200px;
    margin: 0 auto;
  }

  .report-header {
    margin-bottom: 2rem;
  }

  .report-header h1 {
    margin: 0 0 0.5rem 0;
    font-size: 2rem;
    color: #1f2937;
    font-weight: 600;
  }

  .subtitle {
    margin: 0;
    color: #6b7280;
    font-size: 1rem;
  }

  .loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 400px;
  }

  .empty-state {
    text-align: center;
    padding: 3rem;
    color: #6b7280;
  }

  .empty-state p {
    margin: 0.5rem 0;
  }

  /* Stats Container */
  .stats-container {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 2rem;
  }

  .chart-container {
    background: #fff;
    border-radius: 12px;
    padding: 2rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .chart-container h2 {
    margin: 0 0 1.5rem 0;
    font-size: 1.25rem;
    color: #1f2937;
    font-weight: 600;
  }

  .pie-chart-wrapper {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 2rem;
  }

  .pie-chart {
    width: 100%;
    max-width: 400px;
    height: 400px;
  }

  .pie-slice {
    transition: opacity 0.2s;
    cursor: pointer;
  }

  .pie-slice:hover {
    opacity: 0.8;
  }

  .legend {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .legend-color {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .legend-label {
    flex: 1;
    font-size: 0.875rem;
    color: #374151;
  }

  .legend-value {
    font-size: 0.875rem;
    font-weight: 600;
    color: #1f2937;
  }

  .summary-card {
    background: #fff;
    border-radius: 12px;
    padding: 2rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    height: fit-content;
  }

  .summary-card h3 {
    margin: 0 0 1.5rem 0;
    font-size: 1.25rem;
    color: #1f2937;
    font-weight: 600;
  }

  .summary-item {
    display: flex;
    justify-content: space-between;
    padding: 1rem 0;
    border-bottom: 1px solid #e5e7eb;
  }

  .summary-item:last-child {
    border-bottom: none;
  }

  .summary-label {
    color: #6b7280;
    font-size: 0.875rem;
  }

  .summary-value {
    color: #1f2937;
    font-size: 1.125rem;
    font-weight: 600;
  }

  /* Timeline Container */
  .timeline-container {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .line-chart-wrapper {
    background: #fff;
    border-radius: 12px;
    padding: 2rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    overflow-x: auto;
  }

  .line-chart {
    width: 100%;
    min-width: 800px;
    height: 400px;
  }

  .line-path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .data-point {
    cursor: pointer;
    transition: r 0.2s;
  }

  .data-point:hover {
    r: 7;
  }

  .data-table-container {
    background: #fff;
    border-radius: 12px;
    padding: 2rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .data-table-container h3 {
    margin: 0 0 1.5rem 0;
    font-size: 1.25rem;
    color: #1f2937;
    font-weight: 600;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
  }

  .data-table thead {
    background: #f9fafb;
  }

  .data-table th {
    padding: 0.75rem 1rem;
    text-align: left;
    font-size: 0.875rem;
    font-weight: 600;
    color: #374151;
    border-bottom: 2px solid #e5e7eb;
  }

  .data-table td {
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    color: #6b7280;
    border-bottom: 1px solid #e5e7eb;
  }

  .data-table tbody tr:hover {
    background: #f9fafb;
  }

  .data-table tfoot {
    background: #f9fafb;
    font-weight: 600;
  }

  .data-table tfoot td {
    color: #1f2937;
    border-top: 2px solid #e5e7eb;
  }

  .count-cell {
    text-align: right;
    font-weight: 600;
    color: #6366F1;
  }

  /* Responsividade */
  @media (max-width: 1024px) {
    .stats-container {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 768px) {
    .dashboard-layout {
      flex-direction: column;
    }

    .sidebar {
      width: 100%;
      border-right: none;
      border-bottom: 1px solid #e5e7eb;
      max-height: 300px;
    }

    .main-content {
      padding: 1rem;
    }

    .period-buttons {
      grid-template-columns: repeat(3, 1fr);
    }
  }
</style>
