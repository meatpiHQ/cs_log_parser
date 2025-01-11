class Stack {
    constructor() {
        this.items = [];
        this.top = -1;
    }

    isEmpty() {
        return this.top === -1;
    }

    push(value) {
        this.items[++this.top] = value;
        return true;
    }

    pop() {
        if (this.isEmpty()) {
            console.error("Attempted to pop from empty stack");
            return 0;
        }
        return this.items[this.top--];
    }
}

// Expression parser functions
function precedence(operator) {
    if (operator === '|' || operator === '^') return 1;
    if (operator === '&') return 2;
    if (operator === '<' || operator === '>') return 3; // For << and >>
    if (operator === '+' || operator === '-') return 4;
    if (operator === '*' || operator === '/') return 5;
    return 0;
}

function evaluateOperation(operandStack, operatorStack) {
    const operator = operatorStack.pop();
    if (operandStack.isEmpty()) {
        console.error("Operand stack underflow");
        return null;
    }
    const operand2 = operandStack.pop();
    const operand1 = operandStack.pop();
    
    let result;
    switch (operator) {
        case '+': result = operand1 + operand2; break;
        case '-': result = operand1 - operand2; break;
        case '*': result = operand1 * operand2; break;
        case '/':
            if (operand2 === 0) {
                console.error("Division by zero");
                return null;
            }
            result = operand1 / operand2;
            break;
        case '&': result = Math.floor(operand1) & Math.floor(operand2); break;
        case '|': result = Math.floor(operand1) | Math.floor(operand2); break;
        case '^': result = Math.floor(operand1) ^ Math.floor(operand2); break;
        case '<': result = Math.floor(operand1) << Math.floor(operand2); break;
        case '>': result = Math.floor(operand1) >> Math.floor(operand2); break;
    }
    operandStack.push(result);
    return result;
}

function evaluateExpression(expression, data, V) {
    const operandStack = new Stack();
    const operatorStack = new Stack();
    const accessedIndices = new Set();

    function trackAccess(index) {
        accessedIndices.add(index);
    }

    let i = 0;
    while (i < expression.length) {
        if (/\s/.test(expression[i])) {
            i++;
            continue;
        }

        if (/[\d.]/.test(expression[i])) {
            let numStr = '';
            while (i < expression.length && (/[\d.]/.test(expression[i]))) {
                numStr += expression[i];
                i++;
            }
            operandStack.push(parseFloat(numStr));
        } else if (expression[i] === 'V') {
            operandStack.push(V);
            i++;
        } else if (expression[i] === '[') {
            let bracketContent = '';
            i++;
            while (i < expression.length && expression[i] !== ']') {
                bracketContent += expression[i];
                i++;
            }
            i++; // Skip closing bracket

            const match = bracketContent.match(/([BS])(\d+):([BS])(\d+)/);
            if (!match) {
                console.error("Invalid array syntax");
                return null;
            }

            const type = match[1];
            const startIndex = parseInt(match[2]);
            const endIndex = parseInt(match[4]);

            if (endIndex - startIndex > 7) {
                console.error("Range too large for 64-bit storage");
                return null;
            }

            let sum = 0n;
            for (let j = startIndex; j <= endIndex; j++) {
                trackAccess(j);
                const shiftAmount = (endIndex - j) * 8;
                if (type === 'B') {
                    sum |= BigInt(data[j]) << BigInt(shiftAmount);
                } else {
                    const byteValue = data[j];
                    const signedByte = byteValue > 127 ? byteValue - 256 : byteValue;
                    sum |= BigInt(signedByte) << BigInt(shiftAmount);
                }
            }

            const range = endIndex - startIndex;
            if (type === 'S') {
                if (range === 0) {
                    sum = BigInt(Number(sum) << 24 >> 24);
                } else if (range === 1) {
                    sum = BigInt(Number(sum) << 16 >> 16);
                } else if (range <= 3) {
                    sum = BigInt(Number(sum) << 0 >> 0);
                }
            }

            operandStack.push(Number(sum));
        } else if (expression[i] === 'B' || expression[i] === 'S') {
            const type = expression[i];
            i++;
            let index = '';
            while (i < expression.length && /\d/.test(expression[i])) {
                index += expression[i];
                i++;
            }
            index = parseInt(index);
    
            trackAccess(index);
            let value = data[index];
            if (type === 'S') {
                value = value > 127 ? value - 256 : value;
            }
    
            if (expression[i] === ':') {
                i++;
                const bit = parseInt(expression[i]);
                value = (value >> bit) & 1;
                i++;
            }
            operandStack.push(value);
        } else if (expression[i] === '(') {
            operatorStack.push(expression[i]);
            i++;
        } else if (expression[i] === ')') {
            while (!operatorStack.isEmpty() && operatorStack.items[operatorStack.top] !== '(') {
                const result = evaluateOperation(operandStack, operatorStack);
                if (result === null) return null;
            }
            if (!operatorStack.isEmpty() && operatorStack.items[operatorStack.top] === '(') {
                operatorStack.pop();
            } else {
                console.error("Mismatched parentheses");
                return null;
            }
            i++;
        } else if (['+', '-', '*', '/', '&', '|', '^', '<', '>'].includes(expression[i])) {
            let operator = expression[i];
            if ((operator === '<' || operator === '>') && expression[i + 1] === operator) {
                i++;
            }
    
            while (!operatorStack.isEmpty() && 
           precedence(operatorStack.items[operatorStack.top]) >= precedence(operator)) {
                const result = evaluateOperation(operandStack, operatorStack);
                if (result === null) return null;
            }
            operatorStack.push(operator);
            i++;
        } else {
            console.error(`Invalid character: ${expression[i]}`);
            return null;
        }
    }

    while (!operatorStack.isEmpty()) {
        const result = evaluateOperation(operandStack, operatorStack);
        if (result === null) return null;
    }

    if (operandStack.isEmpty() || operandStack.top !== 0) {
        console.error("Invalid expression");
        return null;
    }

    return {
        result: operandStack.items[0],
        accessedIndices: Array.from(accessedIndices)
    };
}

class ELM327Parser {
    constructor() {
        this.secondToLastPID = null;
        this.commands = [];
        this.pidResponses = new Map();
        this.lastProtocol = null;
    }

    isCommand(line) {
        const upperLine = line.toUpperCase();

        if (upperLine.startsWith('>ATSP')){
            this.lastProtocol = upperLine.substring(5);
            console.log("Current Protocol:", this.lastProtocol);
        }
        
        return upperLine.startsWith('>AT') || 
               upperLine.startsWith('>ST') || 
               upperLine.startsWith('>VT');
    }

    isHexNumber(str) {
        return /^[0-9A-Fa-f]+$/.test(str);
    }

    isPIDRequest(line) {
        if (!line.startsWith('>') || this.isCommand(line)) {
            return false;
        }
        
        // Extract the first two characters after '>'
        const potentialHex = line.substring(1, 3);
        return potentialHex.length === 2 && this.isHexNumber(potentialHex);
    }

    formatResponse(response) {
        const protocol = this.lastProtocol;
        if (!protocol) return response;
        console.log("Protocol:", protocol);
        return response.map(line => {
            if (['6', '8'].includes(protocol)) {
                return line.substring(3);
            } else if (['7', '9'].includes(protocol)) {
                return line.substring(8);
            }
            return line;
        });
    }

    parseLog(logContent) {
        const lines = logContent.split(/\r\n|\r|\n/);
    
        // Find the last ATZ command
        let startIndex = 0;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().toUpperCase() === 'ATZ') {
                startIndex = i;
            }
        }
        console.log("Start Index:", startIndex); 
        // Start parsing from the line after the last ATZ command
        const relevantLines = lines.slice(startIndex + 1);
    
        // Continue with existing parsing logic using relevantLines instead of lines
        const pidRequestIndices = [];
        for (let i = 0; i < relevantLines.length - 1; i++) {
            const line = relevantLines[i].trim();
            const first_response_line = relevantLines[i+1].trim();
            if (this.isPIDRequest(line) && this.isHexNumber(first_response_line)) {
                pidRequestIndices.push(i);
            }
        }

        // Process second to last PID request
        if (pidRequestIndices.length >= 2) {
            const lastPIDIndex = pidRequestIndices[pidRequestIndices.length - 1];
            const secondLastPIDIndex = pidRequestIndices[pidRequestIndices.length - 2];
        
            const request = relevantLines[secondLastPIDIndex].trim().substring(1);
        
            const responseLines = [];
            for (let i = secondLastPIDIndex + 1; i < lastPIDIndex; i++) {
                const line = relevantLines[i].trim();
                if (line && !this.isCommand(line)) {
                    responseLines.push(line);
                }
            }
        
            this.secondToLastPID = {
                request: request,
                response: this.formatResponse(responseLines)
            };
        }

        // Process commands (AT/ST/VT)
        let i = 0;
        while (i < relevantLines.length) {
            const line = relevantLines[i].trim();
            if (line.startsWith('>') && this.isCommand(line)) {
                const command = line;
                const responseLines = [];
                let j = i + 1;
            
                // Collect response lines until next command or PID request
                while (j < relevantLines.length) {
                    const responseLine = relevantLines[j].trim();
                    if (!responseLine || 
                        responseLine.startsWith('>') || 
                        responseLine.startsWith('[') ||
                        responseLine === 'Initialize(initMode=Default)') {
                        break;
                    }
                    responseLines.push(responseLine);
                    j++;
                }
            
                const commandToCheck = command.substring(1);
                if (!['ATE0', 'ATD0', 'ATH1', 'ATM0', 'ATRV', 'STI', 'ATS0'].includes(commandToCheck)) {
                    this.commands.push({
                        command: commandToCheck,
                        response: responseLines
                    });
                }    
            
                i = j;
            } else {
                i++;
            }
        }

        // Process all PIDs and their responses
        for (let i = 0; i < pidRequestIndices.length; i++) {
            const currentIndex = pidRequestIndices[i];
            const nextIndex = i < pidRequestIndices.length - 1 ? 
                            pidRequestIndices[i + 1] : 
                            relevantLines.length;
        
            const request = relevantLines[currentIndex].trim().substring(1);
            const responseLines = [];
        
            // Collect response lines until next request
            for (let j = currentIndex + 1; j < nextIndex; j++) {
                const line = relevantLines[j].trim();
                if (line && !line.startsWith('>') && (/^[0-9A-Fa-f]+$/.test(line))) {
                    responseLines.push(line);
                }
            }
        
            if (responseLines.length > 0) {
                this.pidResponses.set(request, responseLines);
            }
        }
    }    
    getSecondToLastPID() {
        return this.secondToLastPID;
    }
    
    getCommands() {
        return this.commands;
    }
    
    getAllPIDResponses() {
        return Array.from(this.pidResponses.entries()).map(([pid, response]) => ({
            pid,
            response
        }));
    }
}
async function handleFileUpload() {
    const fileInput = document.getElementById('logFile');
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    
    errorDiv.style.display = 'none';
    errorDiv.textContent = '';

    if (!fileInput.files.length) {
        errorDiv.textContent = 'Please select a file first.';
        errorDiv.style.display = 'block';
        return;
    }

    const file = fileInput.files[0];
    loadingDiv.style.display = 'block';

    try {
        const content = await file.text();
        const parser = new ELM327Parser();
        parser.parseLog(content);

        // Format the JSON with proper indentation
        const formatJSON = (obj) => JSON.stringify(obj, null, 2);

        // Set up expression evaluation
        const expressionInput = document.getElementById('expression');
        const resultOutput = document.getElementById('result');

        // Store the parser instance globally to access in button click
        window.currentParser = parser;
        
        // Add evaluate button click handler
        document.getElementById('evaluateBtn').addEventListener('click', () => {
            const lastPIDResponse = window.currentParser.getSecondToLastPID();
            
            if (!lastPIDResponse || !lastPIDResponse.response || !lastPIDResponse.response.length) {
                resultOutput.value = 'Error: No valid PID response data';
                return;
            }

            try {
                const hexString = lastPIDResponse.response[0];
                const hexData = hexString.match(/.{1,2}/g) || [];
                const data = new Uint8Array(hexData.map(hex => parseInt(hex, 16)));
                
                const hexStrings = lastPIDResponse.response;
                let allData = new Uint8Array(hexStrings.reduce((acc, line) => acc + (line.match(/.{1,2}/g) || []).length, 0));
                let currentIndex = 0;

                hexStrings.forEach(line => {
                    const hexData = line.match(/.{1,2}/g) || [];
                    hexData.forEach(hex => {
                        allData[currentIndex++] = parseInt(hex, 16);
                    });
                });

                const expression = expressionInput.value;
                if (!expression) {
                    resultOutput.value = 'Error: Empty expression';
                    return;
                }

                const evaluation = evaluateExpression(expression, allData, 0);
                if (evaluation === null || evaluation.result === undefined) {
                    resultOutput.value = 'Error: Invalid expression';
                } else {
                    resultOutput.value = evaluation.result.toString();
                    updateByteDisplay(allData, evaluation.accessedIndices, evaluation.result);
                }
            } catch (error) {
                console.error("Evaluation error:", error);
                resultOutput.value = `Error: ${error.message || 'Unknown error'}`;
            }
        });

        // Display results
        document.getElementById('lastPID').textContent = 
            formatJSON(parser.getSecondToLastPID());
        
        document.getElementById('commands').textContent = 
            formatJSON(parser.getCommands());
        
        document.getElementById('allPIDs').textContent = 
            formatJSON(parser.getAllPIDResponses());

    } catch (error) {
        errorDiv.textContent = `Error parsing file: ${error.message}`;
        errorDiv.style.display = 'block';
    } finally {
        loadingDiv.style.display = 'none';
    }
}
function updateByteDisplay(data, highlightedIndices = [], result = null) {
    const byteDisplay = document.getElementById('byteDisplay');
    byteDisplay.innerHTML = '';
    
    data.forEach((byte, index) => {
        const byteContainer = document.createElement('div');
        byteContainer.className = 'byte-container';
        
        const byteElement = document.createElement('div');
        byteElement.className = `byte ${highlightedIndices.includes(index) ? 'highlighted' : ''}`;
        byteElement.textContent = byte.toString(16).padStart(2, '0').toUpperCase();
        
        const indexElement = document.createElement('div');
        indexElement.className = 'byte-index';
        indexElement.textContent = index;
        
        // if (highlightedIndices.includes(index) && result !== null) {
        //     const resultElement = document.createElement('div');
        //     resultElement.className = 'byte-result';
        //     resultElement.textContent = `→ ${result}`;
        //     byteContainer.appendChild(resultElement);
        // }
        
        byteContainer.appendChild(byteElement);
        byteContainer.appendChild(indexElement);
        byteDisplay.appendChild(byteContainer);
    });
}
