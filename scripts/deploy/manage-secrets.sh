#!/bin/bash

# SOPS uses a public/private key pair for encryption: the public key in .sops.yaml is used for encryption and should be committed to the repository, while the private key in key.txt is used for decryption and must be kept private.
# The .sops.yaml file contains encryption rules and the public key, allowing anyone to encrypt files, but only those with the private key can decrypt them.
# The SOPS_AGE_KEY_FILE environment variable points to the private key file, enabling decryption of the secrets.

set -e

# Constants
SECRETS_DIR="./scripts/deploy/secrets"
AGE_KEY_FILE="${SECRETS_DIR}/key.txt"    # The private key file
SOPS_KEY_FILE="${SECRETS_DIR}/.sops.yaml"  # SOPS configuration file

# Colors for better UX
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

# Check if running from project root
check_project_root() {
    if [ ! -d "src" ]; then
        echo -e "${RED}Error: Please run this script from the project root directory${NC}"
        echo -e "${YELLOW}Current directory: $(pwd)${NC}"
        exit 1
    fi
}

# Check for required tools
check_for_tools() {
    if ! command -v age-keygen &> /dev/null; then
        echo -e "${RED}age-keygen not found. Please install before proceeding${NC}"
        echo -e "${YELLOW}Installation instructions:${NC}"
        echo -e "  See: https://github.com/FiloSottile/age#installation"
        exit 1
    fi

    if ! command -v sops &> /dev/null; then
        echo -e "${RED}sops not found. Please install before proceeding${NC}"
        echo -e "${YELLOW}Installation instructions:${NC}"
        echo -e "  See: https://github.com/getsops/sops#installation"
        exit 1
    fi
}

# Check for required SOPS files
check_required_files() {
    # Check if key exists and is valid
    if [ ! -f "$AGE_KEY_FILE" ]; then
        echo -e "${RED}Error: SOPS key not found. Please run 'Initialize SOPS key' first.${NC}"
        exit 1
    fi

    # Validate key format
    if ! grep -q "AGE-SECRET-KEY" "$AGE_KEY_FILE"; then
        echo -e "${RED}Error: Invalid SOPS key format in $AGE_KEY_FILE${NC}"
        exit 1
    fi
    
    # Check if .sops.yaml exists
    if [ ! -f "$SOPS_KEY_FILE" ]; then
        echo -e "${RED}Error: SOPS config not found at $SOPS_KEY_FILE${NC}"
        echo -e "${YELLOW}Please run 'Initialize SOPS key' first to create the config.${NC}"
        exit 1
    fi
}

# Initialize SOPS key if not exists
init_sops_key() {
    mkdir -p "$SECRETS_DIR"
    
    # Generate key if it doesn't exist
    if [ ! -f "$AGE_KEY_FILE" ]; then
        # Generate a new age key pair
        age-keygen -o "$AGE_KEY_FILE"
        # Extract public key and create SOPS config
        PUBLIC_KEY=$(age-keygen -y "$AGE_KEY_FILE")
        cat > "$SOPS_KEY_FILE" << EOF
creation_rules:
    - age: $PUBLIC_KEY
EOF
        echo -e "${GREEN}Created new SOPS key. Keep $AGE_KEY_FILE safe and never commit it!${NC}"
        echo -e "${GREEN}Created $SOPS_KEY_FILE with your public key${NC}"
    else
        echo -e "${BLUE}SOPS key already exists at ${AGE_KEY_FILE}, skipping creation.${NC}"
    fi
}

# Get available configs from CONFIG_MAP
get_available_configs() {
    if [ ! -f "src/config/config-factory.ts" ]; then
        echo -e "${RED}Error: config-factory.ts not found. Are you in the project root?${NC}"
        exit 1
    fi
    grep -o -E "'CHIS-[A-Z]+':" src/config/config-factory.ts | cut -d"'" -f2 | tr '[:upper:]' '[:lower:]'
}

# Create or update a secret
create_secret() {
    local config=$1  # e.g., "chis-tg", "chis-ke", etc.
    local secret_file="${SECRETS_DIR}/users-${config}-secrets.yaml"
    local env_prefix=$(echo "$config" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
    
    check_required_files
    mkdir -p "$SECRETS_DIR"
    
    # Build secrets in memory
    local secrets_content="cht-user-management:\n  env:"
    
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
        
        secrets_content+="\n    ${env_prefix}_${VAR_NAME}: \"${VAR_VALUE}\""
        echo -e "${GREEN}✓ Added ${env_prefix}_${VAR_NAME}${NC}\n"
    done

    # Write directly to encrypted file
    echo -e "$secrets_content" | SOPS_AGE_KEY_FILE="$AGE_KEY_FILE" sops --config "$SOPS_KEY_FILE" --encrypt \
        --input-type yaml \
        --output-type yaml \
        /dev/stdin > "$secret_file"
    
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

    check_required_files

    # Decrypt using --input-type and --output-type to preserve YAML structure
    SOPS_AGE_KEY_FILE="$AGE_KEY_FILE" sops --config "$SOPS_KEY_FILE" --decrypt \
        --input-type yaml \
        --output-type yaml \
        "$secret_file"
}

# Interactive config selection
select_config() {
    echo -e "${BLUE}Available configurations:${NC}"
    
    # Get configs without removing 'chis-' prefix
    configs=($(get_available_configs))
    
    if [ ${#configs[@]} -eq 0 ]; then
        echo -e "${RED}No configurations found. Are you in the project root?${NC}"
        exit 1
    fi
    
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
check_project_root
check_for_tools

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
        *)
            echo "Invalid option. Exiting..."
            ;;
    esac
fi