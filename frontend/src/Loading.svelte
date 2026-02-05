<script>
  export let currentMessage = '';
</script>

<div class="loading-container">
  <div class="loading-box">
    <div class="spinner-container">
      <div class="spinner"></div>
    </div>
    <div class="loading-message">
      <p>{currentMessage}</p>
    </div>
  </div>
</div>

<style>
  .loading-container {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background-image: url('/background-login.png');
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    background-color: rgba(123, 104, 238, 0.9);
    padding: 2rem;
    position: relative;
    overflow: hidden;
  }

  .loading-box {
    text-align: center;
    z-index: 1;
  }

  .spinner-container {
    margin-bottom: 2rem;
  }

  .spinner {
    width: 60px;
    height: 60px;
    border: 4px solid rgba(255, 255, 255, 0.2);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .loading-message {
    color: white;
  }

  .loading-message p {
    font-size: 1.125rem;
    font-weight: 500;
    margin: 0;
    letter-spacing: 0.3px;
    opacity: 0.95;
  }
</style>
