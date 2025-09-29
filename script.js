document.addEventListener('DOMContentLoaded', () => {
    const mealInput = document.getElementById('meal-input');
    const logMealBtn = document.getElementById('log-meal-btn');
    const clearLogBtn = document.getElementById('clear-log-btn');
    const calorieGoalInput = document.getElementById('calorie-goal');
    const loader = document.getElementById('loader');
    const errorMessage = document.getElementById('error-message');
    const mealLogContainer = document.getElementById('meal-log-container');
    const emptyLogMessage = document.getElementById('empty-log-message');

    // Dashboard elements
    const totalCaloriesEl = document.getElementById('total-calories');
    const totalProteinEl = document.getElementById('total-protein');
    const totalCarbsEl = document.getElementById('total-carbs');
    const totalFatEl = document.getElementById('total-fat');
    const goalDisplayEl = document.getElementById('goal-display');
    const progressBar = document.getElementById('progress-bar');
    
    // --- STATE ---
    let dailyLog = [];
    let calorieGoal = 2000;

    // --- GEMINI API CALL ---
    // The API key is now loaded from the separate, untracked config.js file
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`; 

    const nutritionSchema = {
        type: "OBJECT",
        properties: {
            meal_summary: {
                type: "OBJECT",
                properties: {
                    total_calories: { type: "NUMBER" },
                    total_protein_g: { type: "NUMBER" },
                    total_carbs_g: { type: "NUMBER" },
                    total_fat_g: { type: "NUMBER" }
                },
                required: ["total_calories", "total_protein_g", "total_carbs_g", "total_fat_g"]
            },
            food_items: {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        name: { type: "STRING", description: "Name of the food item" },
                        quantity: { type: "STRING", description: "Estimated quantity, e.g., '2 slices' or '1 cup'" },
                        calories: { type: "NUMBER" },
                        protein_g: { type: "NUMBER" },
                        carbs_g: { type: "NUMBER" },
                        fat_g: { type: "NUMBER" }
                    },
                    required: ["name", "quantity", "calories", "protein_g", "carbs_g", "fat_g"]
                }
            }
        },
        required: ["meal_summary", "food_items"]
    };

    async function getNutritionalInfo(mealDescription) {
        const systemPrompt = "You are an expert nutrition analysis AI. Analyze the user's meal description and provide a detailed nutritional breakdown for each food item. Return the data as a valid JSON object that adheres to the provided schema. Estimate quantities if they are not specified. Calculate the total nutrition for the entire meal.";
        const userQuery = `Analyze this meal: "${mealDescription}"`;
        
        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: nutritionSchema,
            },
        };

        let response;
        try {
            // Exponential backoff retry logic
            let attempt = 0;
            const maxAttempts = 5;
            while (attempt < maxAttempts) {
                response = await fetch(GEMINI_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    break; // Success
                }

                if (response.status === 429 || response.status >= 500) {
                     // Throttling or server error
                    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    attempt++;
                } else {
                    // Other client-side errors, don't retry
                    throw new Error(`API Error: ${response.statusText} (Status: ${response.status})`);
                }
            }
             if (!response.ok) {
                throw new Error(`API request failed after ${maxAttempts} attempts.`);
            }


            const result = await response.json();
            
            const candidate = result.candidates?.[0];
            if (candidate && candidate.content?.parts?.[0]?.text) {
                return JSON.parse(candidate.content.parts[0].text);
            } else {
                console.error("Unexpected API response structure:", result);
                throw new Error("Could not parse the nutritional data from the AI's response.");
            }
        } catch (error) {
            console.error("Error fetching nutritional info:", error);
            throw error;
        }
    }


    // --- UI UPDATE FUNCTIONS ---
    function renderMealLog() {
        mealLogContainer.innerHTML = ''; // Clear existing log
        if (dailyLog.length === 0) {
            mealLogContainer.appendChild(emptyLogMessage);
            emptyLogMessage.classList.remove('hidden');
        } else {
            emptyLogMessage.classList.add('hidden');
            dailyLog.forEach((meal, index) => {
                const mealElement = document.createElement('div');
                mealElement.className = 'meal-item bg-gray-50 p-4 rounded-lg';
                
                let itemsHtml = meal.analysis.food_items.map(item => `
                    <li class="flex justify-between text-sm">
                        <span>${item.name} (${item.quantity})</span>
                        <span class="font-medium">${Math.round(item.calories)} kcal</span>
                    </li>
                `).join('');

                mealElement.innerHTML = `
                    <div class="flex justify-between items-start">
                        <div>
                            <h3 class="font-semibold capitalize">${meal.description}</h3>
                            <p class="text-sm text-gray-600">${Math.round(meal.analysis.meal_summary.total_calories)} kcal &bull; P:${Math.round(meal.analysis.meal_summary.total_protein_g)}g C:${Math.round(meal.analysis.meal_summary.total_carbs_g)}g F:${Math.round(meal.analysis.meal_summary.total_fat_g)}g</p>
                        </div>
                        <button data-index="${index}" class="remove-meal-btn text-red-500 hover:text-red-700 text-sm font-medium">&times; Remove</button>
                    </div>
                    <ul class="mt-2 space-y-1 pl-4 border-l-2 border-gray-200">${itemsHtml}</ul>
                `;
                mealLogContainer.appendChild(mealElement);
            });
            
            // Add event listeners to new remove buttons
            document.querySelectorAll('.remove-meal-btn').forEach(btn => {
               btn.addEventListener('click', handleRemoveMeal);
            });
        }
    }
    
    function updateDashboard() {
        const totals = dailyLog.reduce((acc, meal) => {
            acc.calories += meal.analysis.meal_summary.total_calories || 0;
            acc.protein += meal.analysis.meal_summary.total_protein_g || 0;
            acc.carbs += meal.analysis.meal_summary.total_carbs_g || 0;
            acc.fat += meal.analysis.meal_summary.total_fat_g || 0;
            return acc;
        }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

        totalCaloriesEl.textContent = Math.round(totals.calories);
        totalProteinEl.textContent = `${Math.round(totals.protein)}g`;
        totalCarbsEl.textContent = `${Math.round(totals.carbs)}g`;
        totalFatEl.textContent = `${Math.round(totals.fat)}g`;
        
        // Update progress bar
        const progressPercentage = calorieGoal > 0 ? Math.min((totals.calories / calorieGoal) * 100, 100) : 0;
        progressBar.style.width = `${progressPercentage}%`;

        // Change progress bar color if over goal
        if (totals.calories > calorieGoal) {
            progressBar.classList.remove('bg-green-500');
            progressBar.classList.add('bg-red-500');
        } else {
            progressBar.classList.remove('bg-red-500');
            progressBar.classList.add('bg-green-500');
        }
    }

    function updateUI() {
        renderMealLog();
        updateDashboard();
    }

    // --- EVENT HANDLERS ---
    async function handleLogMeal() {
        const description = mealInput.value.trim();
        if (!description) {
            showError("Please enter a meal description.");
            return;
        }

        // UI updates for loading state
        logMealBtn.disabled = true;
        logMealBtn.textContent = 'Analyzing...';
        loader.classList.remove('hidden');
        errorMessage.classList.add('hidden');

        try {
            const analysis = await getNutritionalInfo(description);
            if (analysis && analysis.meal_summary && analysis.food_items) {
                dailyLog.push({ description, analysis });
                updateUI();
                mealInput.value = ''; // Clear input on success
            } else {
                showError("The AI could not analyze this meal. Please try rephrasing.");
            }
        } catch (error) {
            showError("An error occurred while analyzing the meal. Please check the console and try again.");
        } finally {
            // Reset UI from loading state
            logMealBtn.disabled = false;
            logMealBtn.textContent = 'Analyze & Log Meal';
            loader.classList.add('hidden');
        }
    }

    function handleGoalChange(event) {
        calorieGoal = parseInt(event.target.value, 10) || 0;
        goalDisplayEl.textContent = calorieGoal;
        updateDashboard(); // Recalculate progress
    }
    
    function handleClearLog() {
        if (confirm('Are you sure you want to clear the entire meal log?')) {
            dailyLog = [];
            updateUI();
        }
    }
    
    function handleRemoveMeal(event) {
        const indexToRemove = parseInt(event.target.dataset.index, 10);
        dailyLog.splice(indexToRemove, 1);
        updateUI();
    }

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    }

    // --- INITIALIZATION ---
    logMealBtn.addEventListener('click', handleLogMeal);
    calorieGoalInput.addEventListener('input', handleGoalChange);
    clearLogBtn.addEventListener('click', handleClearLog);
    updateUI(); // Initial render
});