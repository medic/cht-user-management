#!/bin/bash

# Constants
SECRETS_DIR="./scripts/deploy/secrets"
AGE_KEY_FILE="key.txt"  # The private key file

# Colors for better UX
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

# Check for required tools and install if missing
check_and_install_tools() {
    if ! command -v age-keygen &> /dev/null; then
        echo -e "${RED}age-keygen not found. Installing...${NC}"
        brew install age || sudo apt-get install age || {
            echo -e "${RED}Failed to install age. Please install it manually.${NC}"
            exit 1
        }
    fi

    if ! command -v sops &> /dev/null; then
        echo -e "${RED}sops not found. Installing...${NC}"
        brew install sops || sudo apt-get install sops || {
            echo -e "${RED}Failed to install sops. Please install it manually.${NC}"
            exit 1
        }
    fi
}

# Initialize SOPS key if not exists
init_sops_key() {
    if [ ! -f "$AGE_KEY_FILE" ]; then
        # Generate a new age key pair
        age-keygen -o "$AGE_KEY_FILE"
        echo -e "${GREEN}Created new SOPS key. Keep $AGE_KEY_FILE safe and never commit it!${NC}"
    else
        echo -e "${BLUE}SOPS key already exists.${NC}"
    fi
}

# Get available configs from CONFIG_MAP
get_available_configs() {
    grep -o "'CHIS-[A-Z][A-Z]':" src/config/config-factory.ts | tr -d "'" | tr -d ':' | tr '[:upper:]' '[:lower:]'
}

# Create or update a secret
create_secret() {
    local config=$1  # e.g., "chis-tg", "chis-ke", etc.
    local secret_file="${SECRETS_DIR}/users-${config}-secrets.yaml"
    local env_prefix=$(echo "$config" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
    
    mkdir -p "$SECRETS_DIR"
    
    # Create temporary file for building secrets
    local tmp_file="${secret_file}.tmp"
    echo "cht-user-management:" > "$tmp_file"
    echo "  env:" >> "$tmp_file"
    
    # Keep adding variables until user is done
    while true; do
        echo -en "${BLUE}ENV var (without ${env_prefix}_ prefix, or Enter to finish): ${NC}"
        read VAR_NAME
        
        [ -z "$VAR_NAME" ] && break
        
        if [[ "$VAR_NAME" =~ PASSWORD|SECRET|KEY ]]; then
            echo -en "${BLUE}Enter value: ${NC}"
            read -s VAR_VALUE
            echo  # Add newline after secret input
        else
            echo -en "${BLUE}Enter value: ${NC}"
            read VAR_VALUE
        fi
        
        echo "    ${env_prefix}_${VAR_NAME}: \"${VAR_VALUE}\"" >> "$tmp_file"
        echo -e "${GREEN}✓ Added ${env_prefix}_${VAR_NAME}${NC}\n"
    done

    # Encrypt and cleanup
    SOPS_AGE_KEY_FILE="$AGE_KEY_FILE" sops --encrypt \
        --input-type yaml \
        --output-type yaml \
        "$tmp_file" > "$secret_file"
    rm "$tmp_file"
    
    echo -e "${GREEN}Secrets encrypted in $secret_file${NC}"
}

# Decrypt a secret
decrypt_secret() {
    local config=$1
    local secret_file="${SECRETS_DIR}/users-${config}-secrets.yaml"
    
    if [ ! -f "$secret_file" ]; then
        echo -e "${RED}Secret file for ${config} does not exist.${NC}"
        exit 1
    fi

    # Decrypt using --input-type and --output-type to preserve YAML structure
    SOPS_AGE_KEY_FILE="$AGE_KEY_FILE" sops --decrypt \
        --input-type yaml \
        --output-type yaml \
        "$secret_file"
}

# Interactive config selection
select_config() {
    echo -e "${BLUE}Available configurations:${NC}"
    
    # Get configs without removing 'chis-' prefix
    configs=($(get_available_configs))
    
    select config in "${configs[@]}" "quit"; do
        case $config in
            "quit")
                echo "Exiting..."
                exit 0
                ;;
            *)
                if [ -n "$config" ]; then
                    $1 "$config"
                    break
                else
                    echo "Invalid selection. Please try again."
                fi
                ;;
        esac
    done
}

# Main script
check_and_install_tools

if [ "$1" ] && [ "$2" ]; then
    # Non-interactive mode
    action=$1
    config=$2
    if echo "$(get_available_configs)" | grep -q "$config"; then
        case $action in
            "init")
                init_sops_key
                ;;
            "add")
                create_secret "$config"
                ;;
            "decrypt")
                decrypt_secret "$config"
                ;;
            *)
                echo "Invalid action: $action"
                echo "Valid actions: init, add, decrypt"
                exit 1
                ;;
        esac
    else
        echo "Invalid config: $config"
        echo "Available configs: $(get_available_configs | tr '\n' ' ')"
        exit 1
    fi
else
    # Interactive mode
    echo -e "${BLUE}Choose an action:${NC}"
    echo "1) Initialize SOPS key"
    echo "2) Add/Update secrets"
    echo "3) Decrypt secrets"
    echo "4) Quit"

    read -p "Select an option: " action

    case $action in
        1)
            init_sops_key
            ;;
        2)
            select_config create_secret
            ;;
        3)
            select_config decrypt_secret
            ;;
        4)
            echo "Exiting..."
            ;;
        *)
            echo "Invalid option. Exiting..."
            ;;
    esac
fi