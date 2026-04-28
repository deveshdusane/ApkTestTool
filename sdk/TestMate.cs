using UnityEngine;
using UnityEngine.SceneManagement;

public class TestMate : MonoBehaviour
{
    private static TestMate _instance;
    private const string TAG = "[TESTMATE]";

    // Performance detection thresholds
    private float fpsTimer = 0f;
    private int frameCount = 0;
    private const float fpsCheckInterval = 1f; // Check every second
    private const int fpsDropThreshold = 25;   // Log drop if below 25 FPS

    // Auto-bootstrap when the game starts playing
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    private static void Initialize()
    {
        if (_instance == null)
        {
            GameObject go = new GameObject("TestMateAutoTracker");
            _instance = go.AddComponent<TestMate>();
            DontDestroyOnLoad(go);

            // Hook into automatic events
            SceneManager.sceneLoaded += OnSceneLoaded;
            Application.lowMemory += OnLowMemory;

            TrackEvent("SDK_INITIALIZED");
            TrackEvent("GAME_STARTED");
        }
    }

    /// <summary>
    /// Minimal Public API for Manual Event Tracking
    /// </summary>
    public static void TrackEvent(string eventName)
    {
        Debug.Log($"{TAG} {eventName}");
    }

    // ─── AUTO EVENT HANDLERS ──────────────────────────────────────────────────

    private static void OnSceneLoaded(Scene scene, LoadSceneMode mode)
    {
        TrackEvent($"SCENE_LOADED:{scene.name}");
    }

    private static void OnLowMemory()
    {
        TrackEvent("LOW_MEMORY_DETECTED");
    }

    private void OnApplicationPause(bool pauseStatus)
    {
        if (pauseStatus)
        {
            TrackEvent("APP_PAUSED");
        }
        else
        {
            TrackEvent("APP_RESUMED");
        }
    }

    // ─── CONTINUOUS TRACKING LOOP ─────────────────────────────────────────────

    private void Update()
    {
        // 1. Universal Input Tracking
        if (Input.GetMouseButtonDown(0) || 
           (Input.touchCount > 0 && Input.GetTouch(0).phase == TouchPhase.Began))
        {
            TrackEvent("INPUT_DETECTED");
        }

        // 2. Lightweight FPS Drop Tracking
        frameCount++;
        fpsTimer += Time.unscaledDeltaTime;
        if (fpsTimer >= fpsCheckInterval)
        {
            float currentFps = frameCount / fpsTimer;
            if (currentFps < fpsDropThreshold)
            {
                TrackEvent($"FPS_DROP:{Mathf.RoundToInt(currentFps)}");
            }
            
            // Reset for next period
            frameCount = 0;
            fpsTimer = 0f;
        }

        // 3. Simple Memory Tracking Check (System RAM mapping approximation)
        // Log periodically if memory is severely spiked (optional addition beyond Application.lowMemory)
    }

    private void OnDestroy()
    {
        SceneManager.sceneLoaded -= OnSceneLoaded;
        Application.lowMemory -= OnLowMemory;
    }
}
