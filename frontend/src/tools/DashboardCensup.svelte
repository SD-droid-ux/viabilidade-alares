<script>
  import { onMount, onDestroy } from 'svelte';
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
  
  // Dados processados para os gráficos (reativos)
  $: pieChartData = getPieChartData(statsData.stats, statsData.total);
  $: lineChartData = getLineChartData(timelineData.timeline);
  
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
        console.log('📊 [Dashboard] Estatísticas carregadas:', statsData);
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

  // Cores para o gráfico de pizza (paleta roxa do portal)
  const pieColors = [
    '#7B68EE', '#8B5CF6', '#9D7AFF', '#A78BFA', '#C084FC',
    '#D8B4FE', '#E9D5FF', '#F3E8FF', '#6495ED', '#7C3AED'
  ];

  // Função para calcular dados do gráfico de pizza
  function getPieChartData(stats, total) {
    if (!stats || !Array.isArray(stats) || stats.length === 0 || !total || total === 0) {
      return [];
    }

    const centerX = 200;
    const centerY = 200;
    const radius = 150;
    let currentAngle = -90; // Começar do topo

    return stats.map(stat => {
      const sliceAngle = (stat.value / total) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + sliceAngle;

      const startAngleRad = (startAngle * Math.PI) / 180;
      const endAngleRad = (endAngle * Math.PI) / 180;

      const x1 = centerX + radius * Math.cos(startAngleRad);
      const y1 = centerY + radius * Math.sin(startAngleRad);
      const x2 = centerX + radius * Math.cos(endAngleRad);
      const y2 = centerY + radius * Math.sin(endAngleRad);

      const largeArcFlag = sliceAngle > 180 ? 1 : 0;
      const path = `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

      // Posição do label
      const labelAngle = (startAngle + endAngle) / 2;
      const labelAngleRad = (labelAngle * Math.PI) / 180;
      const labelRadius = radius * 0.7;
      const labelX = centerX + labelRadius * Math.cos(labelAngleRad);
      const labelY = centerY + labelRadius * Math.sin(labelAngleRad);

      // Atualizar ângulo para próximo slice
      currentAngle = endAngle;

      return {
        path,
        labelX,
        labelY,
        percentage: stat.percentage
      };
    });
  }

  // Função para calcular dados do gráfico de linha
  function getLineChartData(timeline) {
    if (!timeline || timeline.length === 0) {
      return [];
    }

    const padding = 60;
    const chartWidth = 800 - padding * 2;
    const chartHeight = 400 - padding * 2;
    const maxValue = Math.max(...timeline.map(d => d.count), 1);
    const data = timeline;

    const result = [];

    // Grid
    const gridLines = [];
    for (let i = 0; i < 6; i++) {
      const y = padding + (chartHeight / 5) * i;
      gridLines.push({
        x1: padding,
        y: y,
        x2: 800 - padding,
        labelX: padding - 10,
        label: Math.round(maxValue - (maxValue / 5) * i)
      });
    }
    result.push({ type: 'grid', lines: gridLines });

    // Linha do gráfico
    const linePoints = data.map((d, i) => {
      const x = padding + (chartWidth / (data.length - 1 || 1)) * i;
      const y = padding + chartHeight - (d.count / maxValue) * chartHeight;
      return `${x},${y}`;
    }).join(' ');
    result.push({ type: 'line', points: linePoints });

    // Pontos
    const points = data.map((point, i) => {
      const x = padding + (chartWidth / (data.length - 1 || 1)) * i;
      const y = padding + chartHeight - (point.count / maxValue) * chartHeight;
      return { x, y, count: point.count };
    });
    result.push({ type: 'points', points: points });

    // Labels do eixo X
    const labels = data.map((point, i) => {
      const x = padding + (chartWidth / (data.length - 1 || 1)) * i;
      return { x, y: 400 - padding + 20, text: point.period };
    });
    result.push({ type: 'labels', labels: labels });

    return result;
  }
</script>

<!-- Conteúdo da Ferramenta Dashboard CENSUP -->
<div class="dashboard-censup-content">
  {#if isLoading}
    <div class="full-loading-container">
      <div class="custom-spinner-wrapper">
        <div class="custom-spinner"></div>
        <p class="loading-text">{loadingMessage || 'Carregando...'}</p>
      </div>
    </div>
  {:else}
    <div class="dashboard-layout">
      <!-- Sidebar -->
      <aside class="sidebar">
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
                <div class="custom-spinner-wrapper">
                  <div class="custom-spinner"></div>
                  <p class="loading-text">Carregando estatísticas...</p>
                </div>
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
                    <svg class="pie-chart" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
                      {#if pieChartData && pieChartData.length > 0}
                        {#each pieChartData as slice, index}
                          <path
                            d={slice.path}
                            fill={pieColors[index % pieColors.length]}
                            stroke="#fff"
                            stroke-width="2"
                            class="pie-slice"
                          />
                          <text
                            x={slice.labelX}
                            y={slice.labelY}
                            text-anchor="middle"
                            dominant-baseline="middle"
                            fill="#fff"
                            font-size="14"
                            font-weight="bold"
                          >
                            {slice.percentage}%
                          </text>
                        {/each}
                      {:else}
                        <!-- Círculo vazio quando não há dados -->
                        <circle cx="200" cy="200" r="150" fill="rgba(123, 104, 238, 0.1)" stroke="rgba(123, 104, 238, 0.3)" stroke-width="2" />
                        <text x="200" y="200" text-anchor="middle" dominant-baseline="middle" fill="#7B68EE" font-size="16" font-weight="500">
                          Sem dados
                        </text>
                      {/if}
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
                <div class="custom-spinner-wrapper">
                  <div class="custom-spinner"></div>
                  <p class="loading-text">Carregando timeline...</p>
                </div>
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
                      {#each lineChartData as item}
                        {#if item.type === 'grid'}
                          <!-- Grid -->
                          <g class="grid">
                            {#each item.lines as line}
                              <line x1={line.x1} y1={line.y} x2={line.x2} y2={line.y} stroke="#e5e7eb" stroke-width="1" />
                              <text x={line.labelX} y={line.y} text-anchor="end" dominant-baseline="middle" fill="#6b7280" font-size="12">
                                {line.label}
                              </text>
                            {/each}
                          </g>
                        {:else if item.type === 'line'}
                          <!-- Linha do gráfico -->
                          <polyline
                            points={item.points}
                            fill="none"
                            stroke="#7B68EE"
                            stroke-width="3"
                            class="line-path"
                          />
                        {:else if item.type === 'points'}
                          <!-- Pontos -->
                          {#each item.points as point}
                            <circle
                              cx={point.x}
                              cy={point.y}
                              r="5"
                              fill="#7B68EE"
                              stroke="#fff"
                              stroke-width="2"
                              class="data-point"
                            />
                            <text
                              x={point.x}
                              y={point.y - 15}
                              text-anchor="middle"
                              fill="#374151"
                              font-size="12"
                              font-weight="bold"
                            >
                              {point.count}
                            </text>
                          {/each}
                        {:else if item.type === 'labels'}
                          <!-- Eixo X (períodos) -->
                          <g class="x-axis">
                            {#each item.labels as label}
                              <text
                                x={label.x}
                                y={label.y}
                                text-anchor="middle"
                                fill="#6b7280"
                                font-size="11"
                                transform="rotate(-45 {label.x} {label.y})"
                              >
                                {label.text}
                              </text>
                            {/each}
                          </g>
                        {/if}
                      {/each}
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
    background: rgba(255, 255, 255, 0.95);
    border-right: 1px solid rgba(123, 104, 238, 0.2);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.05);
  }

  .sidebar-nav {
    padding: 1.5rem 1rem 1rem 1rem;
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
    color: #5b21b6;
    font-weight: 500;
  }

  .nav-item:hover {
    background: rgba(123, 104, 238, 0.1);
    color: #4c1d95;
  }

  .nav-item.active {
    background: linear-gradient(135deg, #7B68EE 0%, #6495ED 100%);
    color: #fff;
    box-shadow: 0 2px 6px rgba(123, 104, 238, 0.3);
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
    border-top: 1px solid rgba(123, 104, 238, 0.2);
    border-bottom: 1px solid rgba(123, 104, 238, 0.2);
    background: rgba(123, 104, 238, 0.05);
  }

  .period-selector h3 {
    margin: 0 0 0.75rem 0;
    font-size: 0.875rem;
    color: #4c1d95;
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
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(123, 104, 238, 0.2);
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 500;
    color: #5b21b6;
    transition: all 0.2s;
  }

  .period-btn:hover {
    background: rgba(123, 104, 238, 0.1);
    border-color: #7B68EE;
    color: #4c1d95;
  }

  .period-btn.active {
    background: linear-gradient(135deg, #7B68EE 0%, #6495ED 100%);
    color: #fff;
    border-color: #7B68EE;
    box-shadow: 0 2px 4px rgba(123, 104, 238, 0.2);
  }

  .sidebar-footer {
    padding: 1rem;
    border-top: 1px solid rgba(123, 104, 238, 0.2);
  }

  .refresh-btn {
    width: 100%;
    padding: 0.75rem;
    background: linear-gradient(135deg, #7B68EE 0%, #6495ED 100%);
    color: #fff;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.2s;
    box-shadow: 0 2px 6px rgba(123, 104, 238, 0.3);
  }

  .refresh-btn:hover {
    box-shadow: 0 4px 8px rgba(123, 104, 238, 0.4);
    transform: translateY(-1px);
  }

  /* Main Content */
  .main-content {
    flex: 1;
    overflow-y: auto;
    padding: 2rem;
  }

  .error-message {
    background: rgba(254, 226, 226, 0.9);
    border: 1px solid rgba(123, 104, 238, 0.3);
    color: #991b1b;
    padding: 1rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .error-message button {
    margin-top: 0.5rem;
    padding: 0.5rem 1rem;
    background: linear-gradient(135deg, #7B68EE 0%, #6495ED 100%);
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s;
    box-shadow: 0 2px 6px rgba(123, 104, 238, 0.3);
  }

  .error-message button:hover {
    box-shadow: 0 4px 8px rgba(123, 104, 238, 0.4);
    transform: translateY(-1px);
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
    color: #4c1d95;
    font-weight: 600;
  }

  .subtitle {
    margin: 0;
    color: #5b21b6;
    font-size: 1rem;
    opacity: 0.8;
  }

  .loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 400px;
    padding: 3rem;
  }

  .custom-spinner-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
  }

  .custom-spinner {
    width: 60px;
    height: 60px;
    border: 4px solid rgba(123, 104, 238, 0.2);
    border-top-color: #7B68EE;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .loading-text {
    color: #5b21b6;
    font-size: 1rem;
    font-weight: 500;
    margin: 0;
    opacity: 0.8;
  }

  .full-loading-container {
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    background: #f5f7fa;
  }

  .empty-state {
    text-align: center;
    padding: 3rem;
    color: #5b21b6;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 12px;
    border: 1px solid rgba(123, 104, 238, 0.2);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
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
    background: rgba(255, 255, 255, 0.9);
    border-radius: 12px;
    padding: 2rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(123, 104, 238, 0.2);
  }

  .chart-container h2 {
    margin: 0 0 1.5rem 0;
    font-size: 1.25rem;
    color: #4c1d95;
    font-weight: 600;
    border-bottom: 2px solid #7B68EE;
    padding-bottom: 0.75rem;
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
    color: #5b21b6;
    font-weight: 500;
  }

  .legend-value {
    font-size: 0.875rem;
    font-weight: 600;
    color: #4c1d95;
  }

  .summary-card {
    background: rgba(255, 255, 255, 0.9);
    border-radius: 12px;
    padding: 2rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(123, 104, 238, 0.2);
    height: fit-content;
  }

  .summary-card h3 {
    margin: 0 0 1.5rem 0;
    font-size: 1.25rem;
    color: #4c1d95;
    font-weight: 600;
    border-bottom: 2px solid #7B68EE;
    padding-bottom: 0.75rem;
  }

  .summary-item {
    display: flex;
    justify-content: space-between;
    padding: 1rem 0;
    border-bottom: 1px solid rgba(123, 104, 238, 0.2);
  }

  .summary-item:last-child {
    border-bottom: none;
  }

  .summary-label {
    color: #5b21b6;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .summary-value {
    color: #4c1d95;
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
    background: rgba(255, 255, 255, 0.9);
    border-radius: 12px;
    padding: 2rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(123, 104, 238, 0.2);
    overflow-x: auto;
  }

  .line-chart {
    width: 100%;
    min-width: 800px;
    height: 400px;
  }

  .line-path {
    fill: none;
    stroke: #7B68EE;
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
    background: rgba(255, 255, 255, 0.9);
    border-radius: 12px;
    padding: 2rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(123, 104, 238, 0.2);
  }

  .data-table-container h3 {
    margin: 0 0 1.5rem 0;
    font-size: 1.25rem;
    color: #4c1d95;
    font-weight: 600;
    border-bottom: 2px solid #7B68EE;
    padding-bottom: 0.75rem;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
  }

  .data-table thead {
    background: rgba(123, 104, 238, 0.1);
  }

  .data-table th {
    padding: 0.75rem 1rem;
    text-align: left;
    font-size: 0.875rem;
    font-weight: 600;
    color: #4c1d95;
    border-bottom: 2px solid #7B68EE;
  }

  .data-table td {
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    color: #5b21b6;
    border-bottom: 1px solid rgba(123, 104, 238, 0.2);
  }

  .data-table tbody tr:hover {
    background: rgba(123, 104, 238, 0.05);
  }

  .data-table tfoot {
    background: rgba(123, 104, 238, 0.1);
    font-weight: 600;
  }

  .data-table tfoot td {
    color: #4c1d95;
    border-top: 2px solid #7B68EE;
  }

  .count-cell {
    text-align: right;
    font-weight: 600;
    color: #7B68EE;
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
