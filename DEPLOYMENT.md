# Deployment Guide

This guide will help you deploy the Quantum Music Generator to a web hosting platform.

## Prerequisites

1. A GitHub account
2. Your code pushed to a GitHub repository

## Option 1: Deploy to Render (Recommended)

### Steps:

1. **Sign up for Render**
   - Go to [render.com](https://render.com)
   - Sign up with your GitHub account

2. **Create a New Web Service**
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Select the repository containing this project

3. **Configure the Service**
   - **Name**: `qsound` (or any name you prefer)
   - **Environment**: `Python 3`
   - **Region**: Choose closest to you
   - **Branch**: `main` (or your default branch)
   - **Root Directory**: Leave empty (or `.` if needed)
   - **Runtime**: `Python 3.12` (or the version in runtime.txt)
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app`

4. **Advanced Settings (Optional)**
   - **Auto-Deploy**: Yes (deploys on every push)
   - **Plan**: Free tier is fine to start

5. **Deploy**
   - Click "Create Web Service"
   - Wait for the build to complete (first build may take 5-10 minutes)
   - Your app will be live at `https://your-app-name.onrender.com`

### Notes:
- First deployment may take longer due to installing quantum computing libraries
- Free tier may have cold starts (first request after inactivity may be slow)
- Free tier services sleep after 15 minutes of inactivity

## Option 2: Deploy to Railway

1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Railway will auto-detect Python and deploy
6. Your app will be live automatically

## Option 3: Deploy to Fly.io

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Sign up: `fly auth signup`
3. In your project directory: `fly launch`
4. Follow the prompts
5. Deploy: `fly deploy`

## Testing Locally with Production Settings

To test how it will run in production:

```bash
# Install gunicorn
pip install gunicorn

# Run with gunicorn (production-like)
gunicorn app:app
```

## Environment Variables

If you need to set environment variables (API keys, etc.):

- **Render**: Go to your service → Environment → Add Environment Variable
- **Railway**: Go to your project → Variables tab
- **Fly.io**: Use `fly secrets set KEY=value`

## Troubleshooting

### Build Fails
- Check that all dependencies are in `requirements.txt`
- Ensure Python version in `runtime.txt` is supported
- Check build logs for specific errors

### App Crashes
- Check logs in your hosting platform's dashboard
- Ensure `Procfile` is correct
- Verify `gunicorn` is in `requirements.txt`

### Memory Issues
- Quantum libraries can be memory-intensive
- Consider upgrading to a paid tier if on free tier
- Reduce `num_qubits` in the generator if needed

### Slow Performance
- First request after inactivity may be slow (cold start)
- Quantum simulations are computationally intensive
- Consider adding request timeouts or caching

## Custom Domain (Optional)

Most platforms allow you to add a custom domain:
- **Render**: Settings → Custom Domain
- **Railway**: Settings → Domains
- **Fly.io**: `fly domains add yourdomain.com`

## Monitoring

- Check your platform's dashboard for:
  - Request logs
  - Error logs
  - Resource usage (CPU, memory)
  - Uptime status

