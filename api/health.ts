export const maxDuration = 10;

export default function handler(_req: any, res: any) {
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    success: true,
    service: 'AI Notes Backend',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    geminiKeyConfigured: Boolean(
      (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim()
    ),
  });
}
